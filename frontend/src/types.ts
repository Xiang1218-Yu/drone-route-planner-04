export type Point = { x: number; y: number };

/**
 * 禁飞区时间窗口。
 * - effectiveFrom / effectiveUntil 为 ISO 8601 时间；带显式偏移（Z 或 ±hh:mm）时直接按偏移解析，
 *   不带偏移的本地时间必须配合 timezone（IANA 时区名）解释。
 * - 窗口为半开区间 [from, until)：起飞时刻等于生效时间视为有效，等于失效时间视为已失效。
 * - 只写一端表示该方向不限；两端都缺的窗口视为无效窗口。
 */
export type ZoneTimeWindow = {
  effectiveFrom?: string;
  effectiveUntil?: string;
  timezone?: string;
  /** 来源说明，例如 NOTAM 编号、管制部门通告 */
  source?: string;
};

export type NoFlyZone = {
  id: string;
  name: string;
  kind: 'rectangle' | 'polygon';
  points: Point[];
  color: string;
  /**
   * 生效时间窗口列表（可来自不同来源，取并集）。
   * 缺省表示「未配置时间」，校验时会被明确列为无法确认，而不是静默当作永久有效。
   */
  timeWindows?: ZoneTimeWindow[];
};

export type RoutePlan = {
  id?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  canvas: { width: number; height: number };
  start: Point;
  end: Point;
  waypoints: Point[];
  noFlyZones: NoFlyZone[];
  /** 计划起飞时间，ISO 8601 且必须带时区偏移；未设置时所有时间窗口都无法评估 */
  departureTime?: string;
};

/** active=起飞时刻生效；inactive=已过期或尚未生效；unknown=时间缺失或无效，无法确认 */
export type ZoneTimeStatus = 'active' | 'inactive' | 'unknown';

export type ZoneTimeEvaluation = {
  zoneId: string;
  zoneName: string;
  status: ZoneTimeStatus;
  /** 每个窗口的判定说明，或无法确认的原因 */
  reasons: string[];
  /** 起飞时刻覆盖的窗口来源（多个来源重叠时全部列出） */
  activeSources: string[];
  windowCount: number;
};

export type ZoneTimeSummary = {
  active: ZoneTimeEvaluation[];
  inactive: ZoneTimeEvaluation[];
  unknown: ZoneTimeEvaluation[];
};

export type ValidationIssue = {
  type: 'out-of-bounds' | 'no-fly-zone' | 'no-fly-zone-unconfirmed';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
};

export type ValidationResult = {
  valid: boolean;
  distance: number;
  issues: ValidationIssue[];
  /** 本次校验使用的计划起飞时间（原样回显） */
  departureTime?: string;
  /** 按起飞时刻对禁飞区的分桶：当前有效 / 已过期或未生效 / 无法确认 */
  zones: ZoneTimeSummary;
};
