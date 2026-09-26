import { evaluateZoneSchedule, resolveDepartureInstant } from './timeRules.js';
import type { NoFlyZone, Point, RoutePlan, ZoneTimeReport, ZoneTimeStatus } from './types.js';

export type RouteIssue = {
  type: 'out-of-bounds' | 'no-fly-zone';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
  /** 命中区域在起飞时刻的时效状态；非 active 时表示按保守策略拦截 */
  timeStatus?: ZoneTimeStatus;
};

export type RouteValidation = {
  valid: boolean;
  distance: number;
  issues: RouteIssue[];
  /** 起飞时刻换算后的 UTC ISO 时间；未设置或无法解析时缺省 */
  evaluatedAt?: string;
  /** 每个禁飞区在起飞时刻的时效判定结果，与方案中的区域顺序一致 */
  zoneTimeReports: ZoneTimeReport[];
};

const EPSILON = 1e-8;

export function routePoints(plan: Pick<RoutePlan, 'start' | 'end' | 'waypoints'>): Point[] {
  return [plan.start, ...plan.waypoints, plan.end];
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function routeDistance(points: Point[]): number {
  return points.slice(1).reduce((total, point, index) => total + distanceBetween(points[index], point), 0);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || EPSILON) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
    p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON &&
    Math.abs(orientation(a, b, p)) < EPSILON;
}

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
      ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  return (Math.abs(o1) < EPSILON && onSegment(a, b, c)) ||
    (Math.abs(o2) < EPSILON && onSegment(a, b, d)) ||
    (Math.abs(o3) < EPSILON && onSegment(c, d, a)) ||
    (Math.abs(o4) < EPSILON && onSegment(c, d, b));
}

export function zoneContainsPoint(zone: NoFlyZone, point: Point): boolean {
  return pointInPolygon(point, zone.points);
}

export function segmentIntersectsZone(start: Point, end: Point, zone: NoFlyZone): boolean {
  if (zoneContainsPoint(zone, start) || zoneContainsPoint(zone, end)) return true;
  return zone.points.some((point, index) => segmentsIntersect(start, end, point, zone.points[(index + 1) % zone.points.length]));
}

export function validateRoute(plan: RoutePlan): RouteValidation {
  const points = routePoints(plan);
  const issues: RouteIssue[] = [];
  const { width, height } = plan.canvas;

  const departure = resolveDepartureInstant(plan);
  const departureUtcMs = departure.instant?.utcMs ?? null;
  const zoneTimeReports = plan.noFlyZones.map((zone) => evaluateZoneSchedule(zone, departureUtcMs, departure.error));
  const reportsByZone = new Map(zoneTimeReports.map((report) => [report.zoneId, report]));

  points.forEach((point, index) => {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      issues.push({ type: 'out-of-bounds', message: `节点 ${index + 1} (${point.x}, ${point.y}) 超出画布范围` });
    }
  });

  points.slice(1).forEach((point, index) => {
    const start = points[index];
    plan.noFlyZones.forEach((zone) => {
      const report = reportsByZone.get(zone.id);
      // 明确尚未生效或已过期的区域不拦截；有效、无法确认、时间无效的区域一律拦截
      if (report && !report.enforced) return;
      if (segmentIntersectsZone(start, point, zone)) {
        const unconfirmed = !report || report.status !== 'active';
        issues.push({
          type: 'no-fly-zone',
          message: `航段 ${index + 1} 穿越禁飞区「${zone.name}」${unconfirmed ? '（时效未确认，按有效处理）' : ''}`,
          segmentIndex: index,
          zoneId: zone.id,
          timeStatus: report?.status
        });
      }
    });
  });

  return {
    valid: issues.length === 0,
    distance: routeDistance(points),
    issues,
    evaluatedAt: departure.instant ? new Date(departure.instant.utcMs).toISOString() : undefined,
    zoneTimeReports
  };
}
