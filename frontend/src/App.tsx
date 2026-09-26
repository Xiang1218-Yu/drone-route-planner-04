import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { planApi } from './api';
import { distanceBetween, routePoints, validateRoute } from './geometry';
import type { NoFlyZone, Point, RoutePlan, ValidationResult } from './types';

const CANVAS = { width: 100, height: 70 };
const ZONE_COLORS = ['#fb7185', '#f59e0b', '#a78bfa', '#38bdf8'];

type Tool = 'select' | 'start' | 'end' | 'waypoint' | 'rectangle' | 'polygon';

const initialPlan: RoutePlan = {
  name: '北侧巡检任务',
  canvas: CANVAS,
  start: { x: 12, y: 56 },
  end: { x: 87, y: 14 },
  waypoints: [{ x: 33, y: 46 }, { x: 65, y: 28 }],
  noFlyZones: [
    { id: 'zone-demo', name: '高压线保护区', kind: 'rectangle', points: [{ x: 43, y: 17 }, { x: 64, y: 17 }, { x: 64, y: 38 }, { x: 43, y: 38 }], color: '#fb7185' }
  ]
};

function formatDistance(value: number) {
  return `${value.toFixed(1)} km`;
}

function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>, svg: SVGSVGElement): Point {
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(CANVAS.width, ((event.clientX - rect.left) / rect.width) * CANVAS.width)),
    y: Math.max(0, Math.min(CANVAS.height, ((event.clientY - rect.top) / rect.height) * CANVAS.height))
  };
}

function pointText(point: Point) {
  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`;
}

export default function App() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [plan, setPlan] = useState<RoutePlan>(initialPlan);
  const [tool, setTool] = useState<Tool>('select');
  const [draftPolygon, setDraftPolygon] = useState<Point[]>([]);
  const [validation, setValidation] = useState<ValidationResult>(() => validateRoute(initialPlan));
  const [savedPlans, setSavedPlans] = useState<RoutePlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [notice, setNotice] = useState('点击画布或使用左侧工具编辑航线');

  useEffect(() => {
    planApi.list().then(({ plans }) => setSavedPlans(plans)).catch(() => setNotice('API 尚未启动，仍可在本地编辑方案'));
  }, []);

  useEffect(() => setValidation(validateRoute(plan)), [plan]);

  const points = useMemo(() => routePoints(plan), [plan]);
  const activeSegment = new Set(validation.issues.map((issue) => issue.segmentIndex).filter((index): index is number => index !== undefined));

  const updatePlan = (patch: Partial<RoutePlan>) => setPlan((current) => ({ ...current, ...patch }));

  const handleCanvasClick = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const point = pointFromEvent(event, svgRef.current);
    if (tool === 'start') {
      updatePlan({ start: point });
      setNotice(`起点已更新为 ${pointText(point)}`);
    } else if (tool === 'end') {
      updatePlan({ end: point });
      setNotice(`终点已更新为 ${pointText(point)}`);
    } else if (tool === 'waypoint') {
      updatePlan({ waypoints: [...plan.waypoints, point] });
      setNotice(`已添加航点 ${pointText(point)}`);
    } else if (tool === 'polygon') {
      setDraftPolygon((draft) => [...draft, point]);
    }
  };

  const finishPolygon = () => {
    if (draftPolygon.length < 3) {
      setNotice('多边形至少需要 3 个点');
      return;
    }
    const index = plan.noFlyZones.length;
    const zone: NoFlyZone = {
      id: `zone-${Date.now()}`,
      name: `禁飞区 ${index + 1}`,
      kind: 'polygon',
      points: draftPolygon,
      color: ZONE_COLORS[index % ZONE_COLORS.length]
    };
    updatePlan({ noFlyZones: [...plan.noFlyZones, zone] });
    setDraftPolygon([]);
    setTool('select');
    setNotice(`已创建 ${zone.name}`);
  };

  const handleRectangle = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'rectangle' || !svgRef.current) return;
    const point = pointFromEvent(event, svgRef.current);
    const width = 13;
    const height = 11;
    const x = Math.max(1, Math.min(CANVAS.width - width - 1, point.x - width / 2));
    const y = Math.max(1, Math.min(CANVAS.height - height - 1, point.y - height / 2));
    const index = plan.noFlyZones.length;
    const zone: NoFlyZone = {
      id: `zone-${Date.now()}`,
      name: `矩形禁飞区 ${index + 1}`,
      kind: 'rectangle',
      points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }],
      color: ZONE_COLORS[index % ZONE_COLORS.length]
    };
    updatePlan({ noFlyZones: [...plan.noFlyZones, zone] });
    setTool('select');
    setNotice(`已创建 ${zone.name}`);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'rectangle') handleRectangle(event);
  };

  const removeWaypoint = (index: number) => updatePlan({ waypoints: plan.waypoints.filter((_, waypointIndex) => waypointIndex !== index) });
  const removeZone = (id: string) => updatePlan({ noFlyZones: plan.noFlyZones.filter((zone) => zone.id !== id) });

  const save = async () => {
    setSaveState('saving');
    try {
      const { plan: saved } = await planApi.save({ ...plan, id: activePlanId });
      setActivePlanId(saved.id);
      setPlan(saved);
      setSavedPlans((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSaveState('saved');
      setNotice('方案已保存到内存 API');
      window.setTimeout(() => setSaveState('idle'), 1800);
    } catch {
      setSaveState('error');
      setNotice('保存失败：请确认后端运行在 http://localhost:4000');
    }
  };

  const loadPlan = (saved: RoutePlan) => {
    setPlan(saved);
    setActivePlanId(saved.id);
    setDraftPolygon([]);
    setNotice(`已加载「${saved.name}」`);
  };

  const newPlan = () => {
    setPlan({ ...initialPlan, name: '未命名航线', id: undefined, waypoints: [], noFlyZones: [] });
    setActivePlanId(undefined);
    setDraftPolygon([]);
    setNotice('已新建空白方案');
  };

  const toolItems: Array<{ id: Tool; label: string; icon: string; hint: string }> = [
    { id: 'select', label: '选择', icon: '↖', hint: '浏览画布' },
    { id: 'start', label: '起点', icon: 'S', hint: '点击设置起点' },
    { id: 'end', label: '终点', icon: 'E', hint: '点击设置终点' },
    { id: 'waypoint', label: '航点', icon: '✦', hint: '点击添加航点' },
    { id: 'rectangle', label: '矩形禁飞区', icon: '▧', hint: '点击放置矩形' },
    { id: 'polygon', label: '多边形禁飞区', icon: '⬠', hint: '逐点绘制后完成' }
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">✦</div>
          <div><strong>SkyRoute</strong><span>无人机航线规划工作台</span></div>
        </div>
        <div className="topbar-actions">
          <span className="status-dot"><i /> 本地工作区</span>
          <button className="ghost-button" onClick={newPlan}>＋ 新建方案</button>
          <button className="primary-button" onClick={save}>{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存 ✓' : '保存方案'}</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="side-section project-section">
            <div className="section-eyebrow">当前任务</div>
            <input className="plan-name" value={plan.name} onChange={(event) => updatePlan({ name: event.target.value })} aria-label="方案名称" />
            <div className="subtle-text">二维航线 · 坐标单位 km</div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>编辑工具</span><small>{tool === 'polygon' ? '绘制中' : '选择操作'}</small></div>
            <div className="tool-grid">
              {toolItems.map((item) => <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} onClick={() => { setTool(item.id); if (item.id !== 'polygon') setDraftPolygon([]); }} title={item.hint}><b>{item.icon}</b><span>{item.label}</span></button>)}
            </div>
            {tool === 'polygon' && <button className="complete-button" onClick={finishPolygon}>完成多边形 ({draftPolygon.length} 点)</button>}
            <div className="tool-hint">{toolItems.find((item) => item.id === tool)?.hint}</div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>航点列表</span><strong>{plan.waypoints.length}</strong></div>
            <div className="node-row start-row"><span className="node-badge start">S</span><div><b>起点</b><small>{pointText(plan.start)}</small></div></div>
            {plan.waypoints.map((waypoint, index) => <div className="node-row" key={`${waypoint.x}-${waypoint.y}-${index}`}><span className="node-badge waypoint">{index + 1}</span><div><b>航点 {String(index + 1).padStart(2, '0')}</b><small>{pointText(waypoint)}</small></div><button className="remove-button" onClick={() => removeWaypoint(index)}>×</button></div>)}
            <div className="node-row end-row"><span className="node-badge end">E</span><div><b>终点</b><small>{pointText(plan.end)}</small></div></div>
          </section>

          <section className="side-section">
            <div className="section-title"><span>禁飞区</span><strong>{plan.noFlyZones.length}</strong></div>
            {plan.noFlyZones.length === 0 && <div className="empty-row">暂无禁飞区</div>}
            {plan.noFlyZones.map((zone) => <div className="zone-row" key={zone.id}><span className="zone-swatch" style={{ background: zone.color }} /><div><b>{zone.name}</b><small>{zone.kind === 'rectangle' ? '矩形区域' : `${zone.points.length} 边形区域`}</small></div><button className="remove-button" onClick={() => removeZone(zone.id)}>×</button></div>)}
          </section>

          <section className="side-section saved-section">
            <div className="section-title"><span>已保存方案</span><strong>{savedPlans.length}</strong></div>
            {savedPlans.length === 0 && <div className="empty-row">保存后将在这里显示</div>}
            {savedPlans.slice(0, 4).map((saved) => <button className="saved-plan" key={saved.id} onClick={() => loadPlan(saved)}><span>{saved.name}</span><small>{saved.updatedAt ? new Date(saved.updatedAt).toLocaleDateString('zh-CN') : '—'}</small></button>)}
          </section>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar"><div><span className="breadcrumb">航线规划 / </span><strong>{plan.name}</strong></div><div className="toolbar-right"><span className="canvas-size">100 × 70 km</span><span className={`validation-chip ${validation.valid ? 'valid' : 'invalid'}`}>{validation.valid ? '路径可执行' : `${validation.issues.length} 项风险`}</span></div></div>
          <div className="canvas-wrap">
            <svg ref={svgRef} className="route-canvas" viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} onPointerUp={handlePointerUp} onClick={handleCanvasClick} role="img" aria-label="无人机航线二维坐标画布">
              <defs>
                <pattern id="minorGrid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#dbe8e7" strokeWidth="0.22" /></pattern>
                <pattern id="majorGrid" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="url(#minorGrid)" /><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#b9d1d0" strokeWidth="0.32" /></pattern>
                <filter id="routeGlow"><feGaussianBlur stdDeviation="0.7" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>
              <rect width={CANVAS.width} height={CANVAS.height} fill="#f7fbfa" />
              <rect width={CANVAS.width} height={CANVAS.height} fill="url(#majorGrid)" />
              {plan.noFlyZones.map((zone) => <polygon key={zone.id} points={zone.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={zone.color} fillOpacity="0.19" stroke={zone.color} strokeWidth="0.7" strokeDasharray="1.5 1" />)}
              {draftPolygon.length > 0 && <><polyline points={draftPolygon.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0f766e" strokeWidth="0.65" strokeDasharray="1.5 1" />{draftPolygon.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="1.15" fill="#0f766e" />)}</>}
              {points.slice(1).map((point, index) => <line key={index} x1={points[index].x} y1={points[index].y} x2={point.x} y2={point.y} stroke={activeSegment.has(index) ? '#ef4444' : '#0e7490'} strokeWidth={activeSegment.has(index) ? '1.1' : '0.85'} strokeLinecap="round" strokeDasharray={activeSegment.has(index) ? '2 1' : undefined} filter={activeSegment.has(index) ? undefined : 'url(#routeGlow)'} />)}
              {plan.waypoints.map((point, index) => <g key={`${point.x}-${point.y}-${index}`}><circle cx={point.x} cy={point.y} r="2" fill="#ffffff" stroke="#0e7490" strokeWidth="0.7" /><text x={point.x} y={point.y + 0.7} textAnchor="middle" fontSize="1.8" fontWeight="700" fill="#0e7490">{index + 1}</text></g>)}
              <g><circle cx={plan.start.x} cy={plan.start.y} r="2.6" fill="#0f766e" stroke="#ffffff" strokeWidth="0.8" /><text x={plan.start.x} y={plan.start.y + 0.9} textAnchor="middle" fontSize="2.5" fontWeight="800" fill="#ffffff">S</text></g>
              <g><circle cx={plan.end.x} cy={plan.end.y} r="2.6" fill="#e85d4a" stroke="#ffffff" strokeWidth="0.8" /><text x={plan.end.x} y={plan.end.y + 0.9} textAnchor="middle" fontSize="2.5" fontWeight="800" fill="#ffffff">E</text></g>
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => <text key={`x-${value}`} x={value} y={CANVAS.height + 3.3} textAnchor={value === 0 ? 'start' : value === 100 ? 'end' : 'middle'} fontSize="2.3" fill="#648383">{value}</text>)}
              {[0, 10, 20, 30, 40, 50, 60, 70].map((value) => <text key={`y-${value}`} x={-1.5} y={CANVAS.height - value + 0.8} textAnchor="end" fontSize="2.3" fill="#648383">{value}</text>)}
            </svg>
            <div className="canvas-compass"><span>北</span><b>↑</b></div>
            <div className="canvas-legend"><span><i className="legend-line" />规划航线</span><span><i className="legend-zone" />禁飞区</span><span><i className="legend-risk" />风险航段</span></div>
          </div>
          <div className="canvas-footer"><span>{notice}</span><span>提示：所有坐标均以左下角为原点</span></div>
        </section>

        <aside className="inspector">
          <section className="metric-card primary-metric"><div className="metric-label">航线总距离</div><div className="metric-value">{formatDistance(validation.distance)}</div><div className="metric-caption">{points.length - 1} 个航段 · 预计 18 分钟</div><div className="metric-spark"><span style={{ height: '35%' }} /><span style={{ height: '55%' }} /><span style={{ height: '42%' }} /><span style={{ height: '75%' }} /><span style={{ height: '65%' }} /><span style={{ height: '92%' }} /><span style={{ height: '78%' }} /><span style={{ height: '100%' }} /></div></section>
          <section className={`validation-card ${validation.valid ? 'is-valid' : 'has-error'}`}><div className="validation-heading"><span className="validation-icon">{validation.valid ? '✓' : '!'}</span><div><b>{validation.valid ? '校验通过' : '需要调整'}</b><small>{validation.valid ? '未发现越界或穿越禁飞区' : '请查看下方风险项'}</small></div></div>{validation.issues.length > 0 && <div className="issue-list">{validation.issues.slice(0, 4).map((issue, index) => <div className="issue-item" key={`${issue.message}-${index}`}><span>×</span>{issue.message}</div>)}</div>}</section>
          <section className="inspector-section"><div className="section-title"><span>航线摘要</span><small>实时计算</small></div><div className="summary-list"><div><span>起点</span><b>{pointText(plan.start)}</b></div><div><span>终点</span><b>{pointText(plan.end)}</b></div><div><span>航点</span><b>{plan.waypoints.length} 个</b></div><div><span>禁飞区</span><b>{plan.noFlyZones.length} 个</b></div></div></section>
          <section className="inspector-section"><div className="section-title"><span>快捷操作</span></div><button className="outline-action" onClick={() => { updatePlan({ waypoints: [] }); setNotice('已清空所有航点'); }}>清空航点</button><button className="outline-action" onClick={() => { updatePlan({ noFlyZones: [] }); setNotice('已移除所有禁飞区'); }}>移除禁飞区</button><button className="outline-action" onClick={() => setValidation(validateRoute(plan))}>重新校验路径 <span>⌘↵</span></button></section>
          <section className="api-note"><div className="api-icon">⌁</div><div><b>内存 REST API</b><small>保存到当前 Node.js 进程，重启后清空</small></div></section>
        </aside>
      </main>
    </div>
  );
}
