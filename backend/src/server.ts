import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { validateRoute } from './geometry.js';
import { deletePlan, getPlan, listPlans, savePlan } from './store.js';
import type { NoFlyZone, Point, RoutePlan, ZoneSchedule } from './types.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/** 只保留合法的时效字段；旧数据没有 schedule 时保持 undefined，绝不补默认时间 */
function normalizeSchedule(raw: unknown): ZoneSchedule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const schedule: ZoneSchedule = {};
  if (typeof source.effectiveFrom === 'string' && source.effectiveFrom) schedule.effectiveFrom = source.effectiveFrom;
  if (typeof source.effectiveTo === 'string' && source.effectiveTo) schedule.effectiveTo = source.effectiveTo;
  if (typeof source.timeZone === 'string' && source.timeZone) schedule.timeZone = source.timeZone;
  if (typeof source.source === 'string' && source.source) schedule.source = source.source;
  return Object.keys(schedule).length > 0 ? schedule : undefined;
}

function normalizePoint(raw: unknown): Point | null {
  if (!raw || typeof raw !== 'object') return null;
  const point = raw as Record<string, unknown>;
  return typeof point.x === 'number' && typeof point.y === 'number' ? { x: point.x, y: point.y } : null;
}

function normalizeZone(raw: unknown): NoFlyZone | null {
  if (!raw || typeof raw !== 'object') return null;
  const zone = raw as Record<string, unknown>;
  if (typeof zone.id !== 'string' || !Array.isArray(zone.points)) return null;
  return {
    id: zone.id,
    name: typeof zone.name === 'string' && zone.name ? zone.name : '未命名区域',
    kind: zone.kind === 'polygon' ? 'polygon' : 'rectangle',
    points: zone.points.map(normalizePoint).filter((point): point is Point => point !== null),
    color: typeof zone.color === 'string' ? zone.color : undefined,
    schedule: normalizeSchedule(zone.schedule)
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** 把请求体整理成可校验/可保存的方案结构，POST /api/plans 与 /api/validate 共用 */
function planFromBody(body: Record<string, unknown>): Omit<RoutePlan, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<RoutePlan, 'id' | 'createdAt'>> {
  return {
    id: optionalString(body.id),
    createdAt: optionalString(body.createdAt),
    name: String(body.name),
    canvas: body.canvas as RoutePlan['canvas'],
    start: body.start as Point,
    end: body.end as Point,
    waypoints: Array.isArray(body.waypoints) ? body.waypoints.map(normalizePoint).filter((point): point is Point => point !== null) : [],
    noFlyZones: Array.isArray(body.noFlyZones) ? body.noFlyZones.map(normalizeZone).filter((zone): zone is NoFlyZone => zone !== null) : [],
    departureTime: optionalString(body.departureTime),
    departureTimeZone: optionalString(body.departureTimeZone)
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'drone-route-planner-api' });
});

app.get('/api/plans', (_req, res) => {
  res.json({ plans: listPlans() });
});

app.get('/api/plans/:id', (req, res) => {
  const plan = getPlan(req.params.id);
  if (!plan) return res.status(404).json({ message: '找不到该航线方案' });
  return res.json({ plan });
});

app.post('/api/plans', (req: Request<unknown, unknown, Partial<RoutePlan>>, res: Response) => {
  const body = req.body;
  if (!body || !body.name || !body.canvas || !body.start || !body.end) {
    return res.status(400).json({ message: 'name、canvas、start、end 为必填字段' });
  }

  const plan = savePlan(planFromBody(body as Record<string, unknown>));

  return res.status(body.id ? 200 : 201).json({ plan, validation: validateRoute(plan) });
});

/** 只校验不保存：值班人员可传入方案草稿与起飞时间，获取带时效说明的校验结果 */
app.post('/api/validate', (req: Request<unknown, unknown, Partial<RoutePlan>>, res: Response) => {
  const body = req.body;
  if (!body || !body.canvas || !body.start || !body.end) {
    return res.status(400).json({ message: 'canvas、start、end 为必填字段' });
  }

  const draft = planFromBody(body as Record<string, unknown>);
  const plan: RoutePlan = {
    ...draft,
    id: draft.id ?? 'validation-preview',
    name: draft.name ?? '临时校验',
    createdAt: draft.createdAt ?? '',
    updatedAt: ''
  };

  return res.json({ validation: validateRoute(plan) });
});

app.delete('/api/plans/:id', (req, res) => {
  if (!deletePlan(req.params.id)) return res.status(404).json({ message: '找不到该航线方案' });
  return res.status(204).send();
});

app.listen(port, () => {
  console.log(`Drone Route Planner API listening on http://localhost:${port}`);
});
