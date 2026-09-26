export type Point = { x: number; y: number };

/**
 * 区域的时效规则。所有字段可选，但「未配置时间」不等于「永不过期」：
 * 校验时缺少时间信息的区域会被标记为「无法确认」并按有效处理。
 */
export type ZoneSchedule = {
  /** 生效时间，datetime-local 格式（YYYY-MM-DDTHH:mm），按 timeZone 解释；缺省表示不设下限 */
  effectiveFrom?: string;
  /** 失效时间，格式同上；缺省表示不设上限。窗口为 [effectiveFrom, effectiveTo)：生效含边界、失效不含边界 */
  effectiveTo?: string;
  /** IANA 时区名（如 Asia/Shanghai）。配置了时间但缺少时区时，该区域按「无法确认」处理 */
  timeZone?: string;
  /** 来源说明，如 NOTAM 编号、管制通告名称 */
  source?: string;
};

export type NoFlyZone = {
  id: string;
  name: string;
  kind: 'rectangle' | 'polygon';
  points: Point[];
  color: string;
  schedule?: ZoneSchedule;
};

export type RoutePlan = {
  id?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  canvas: { width: number; height: number };
  /** 计划起飞时间，datetime-local 格式（YYYY-MM-DDTHH:mm），按 departureTimeZone 解释 */
  departureTime?: string;
  /** 起飞时间对应的 IANA 时区名 */
  departureTimeZone?: string;
  start: Point;
  end: Point;
  waypoints: Point[];
  noFlyZones: NoFlyZone[];
};

/**
 * 区域在起飞时刻的时效状态：
 * - active：起飞时刻处于生效窗口内
 * - not-yet-active：起飞时刻早于生效时间
 * - expired：起飞时刻不早于失效时间
 * - invalid：时间范围无效或无法解析（保守按有效处理）
 * - unknown：缺少时间/时区/起飞时间，无法确认（保守按有效处理）
 */
export type ZoneTimeStatus = 'active' | 'not-yet-active' | 'expired' | 'invalid' | 'unknown';

export type ZoneTimeReport = {
  zoneId: string;
  zoneName: string;
  status: ZoneTimeStatus;
  /** 本次校验是否拦截该区域：仅「尚未生效」「已过期」放行，其余一律拦截 */
  enforced: boolean;
  /** 人类可读的状态说明 */
  reason: string;
  source?: string;
  timeZone?: string;
  /** 解析后的生效/失效 UTC 时刻（ISO 字符串），便于核对时区换算结果 */
  effectiveFromUtc?: string;
  effectiveToUtc?: string;
};

export type ValidationIssue = {
  type: 'out-of-bounds' | 'no-fly-zone';
  message: string;
  segmentIndex?: number;
  zoneId?: string;
  /** 命中区域在起飞时刻的时效状态；非 active 时表示按保守策略拦截 */
  timeStatus?: ZoneTimeStatus;
};

export type ValidationResult = {
  valid: boolean;
  distance: number;
  issues: ValidationIssue[];
  /** 起飞时刻换算后的 UTC ISO 时间；未设置或无法解析时缺省 */
  evaluatedAt?: string;
  /** 每个禁飞区在起飞时刻的时效判定结果，与方案中的区域顺序一致 */
  zoneTimeReports: ZoneTimeReport[];
};
