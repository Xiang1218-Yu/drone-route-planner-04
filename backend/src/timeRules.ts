import type { NoFlyZone, RoutePlan, ZoneTimeReport } from './types.js';

export type DepartureInstant = { utcMs: number; timeZone: string };

export type DepartureResolution = { instant?: DepartureInstant; error?: string };

const HOUR_MS = 3_600_000;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 把墙钟字段转成毫秒数（借用 UTC 刻度表示墙钟，不含时区含义）；0-99 年按字面年份处理 */
function wallToMs(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year >= 0 && year < 100) date.setUTCFullYear(year);
  return date.getTime();
}

/**
 * 解析 datetime-local 格式的墙上时间（YYYY-MM-DDTHH:mm[:ss]）。
 * 返回以 UTC 刻度表示的墙钟毫秒数；格式错误或日期不存在（如 2026-02-31）时返回 null。
 */
export function parseLocalDateTime(value: string): number | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const wallMs = wallToMs(year, month, day, hour, minute, second);
  // Date.UTC 会把 2 月 31 日这类越界日期顺延，回读校验确保日期真实存在
  const check = new Date(wallMs);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return wallMs;
}

const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!formatterCache.has(timeZone)) {
    let formatter: Intl.DateTimeFormat | null;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
      });
    } catch {
      formatter = null;
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatterCache.get(timeZone) ?? null;
}

/** 某一 UTC 瞬点在指定时区下对应的墙上时间（同样以 UTC 刻度表示） */
function wallClockAt(utcMs: number, formatter: Intl.DateTimeFormat): number {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return wallToMs(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * 把「IANA 时区 + 墙上时间」换算成唯一确定的 UTC 瞬点（毫秒）。规则：
 * - 正常时间：直接换算；
 * - 夏令时拨快产生的不存在时间（如 02:30 被跳过）：顺延到之后第一个真实存在的时刻；
 * - 夏令时回拨产生的重复时间（如 01:30 出现两次）：固定取第一次出现（UTC 较小者）；
 * - 格式错误、日期不存在或时区无法识别：返回 null。
 * 以上规则对所有区域、所有来源一致适用，保证结果无歧义。
 */
export function zonedTimeToUtc(localDateTime: string, timeZone: string): number | null {
  const formatter = getFormatter(timeZone);
  if (!formatter) return null;
  const wallMs = parseLocalDateTime(localDateTime);
  if (wallMs === null) return null;

  // 在目标墙钟附近采样可能的 UTC 偏移（覆盖 ±14 小时的所有时区）
  const offsets = new Set(
    [-14 * HOUR_MS, 0, 14 * HOUR_MS].map((delta) => wallClockAt(wallMs + delta, formatter) - (wallMs + delta))
  );
  // 回读验证：只有能精确映射回目标墙钟的 UTC 瞬点才是候选
  const candidates = [...offsets]
    .map((offset) => wallMs - offset)
    .filter((utcMs) => wallClockAt(utcMs, formatter) === wallMs);
  // 正常时间有 1 个候选；夏令时回拨有 2 个候选，取第一次出现
  if (candidates.length > 0) return Math.min(...candidates);

  // 墙上时间不存在（夏令时空隙）：在空隙附近二分查找第一个墙钟 >= 目标墙钟的瞬点。
  // 空隙处墙钟随 UTC 单调不减，±26 小时的窗口必然覆盖答案。
  let lo = wallMs - 26 * HOUR_MS;
  let hi = wallMs + 26 * HOUR_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (wallClockAt(mid, formatter) >= wallMs) hi = mid;
    else lo = mid;
  }
  // 墙钟只有秒级精度，而时区切换总发生在整秒，向上对齐到整秒得到确定结果
  return Math.ceil(hi / 1000) * 1000;
}

/** 解析方案的起飞时刻；未设置或无法解释时返回人类可读的错误说明 */
export function resolveDepartureInstant(plan: Pick<RoutePlan, 'departureTime' | 'departureTimeZone'>): DepartureResolution {
  if (!plan.departureTime) return { error: '未设置起飞时间' };
  if (!plan.departureTimeZone) return { error: '起飞时间未标注时区' };
  const utcMs = zonedTimeToUtc(plan.departureTime, plan.departureTimeZone);
  if (utcMs === null) return { error: `起飞时间「${plan.departureTime}」或时区「${plan.departureTimeZone}」无法解析` };
  return { instant: { utcMs, timeZone: plan.departureTimeZone } };
}

function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/**
 * 评估单个区域在起飞时刻的时效状态。
 * 判定完全由输入数据决定，不读取系统当前时间，离线编辑与后端校验结果一致。
 */
export function evaluateZoneSchedule(zone: NoFlyZone, departureUtcMs: number | null, departureError?: string): ZoneTimeReport {
  const schedule = zone.schedule;
  const base = {
    zoneId: zone.id,
    zoneName: zone.name,
    source: schedule?.source,
    timeZone: schedule?.timeZone
  };
  const hasFrom = Boolean(schedule?.effectiveFrom);
  const hasTo = Boolean(schedule?.effectiveTo);

  if (!schedule || (!hasFrom && !hasTo)) {
    return { ...base, status: 'unknown', enforced: true, reason: '未配置生效/失效时间，无法确认时效，按有效处理' };
  }
  if (!schedule.timeZone) {
    return { ...base, status: 'unknown', enforced: true, reason: '已配置时间但缺少时区，无法换算成确定时刻，按有效处理' };
  }
  if (departureUtcMs === null) {
    return { ...base, status: 'unknown', enforced: true, reason: `${departureError ?? '未设置起飞时间'}，无法判断区域是否生效，按有效处理` };
  }

  const fromUtc = hasFrom ? zonedTimeToUtc(schedule.effectiveFrom as string, schedule.timeZone) : null;
  const toUtc = hasTo ? zonedTimeToUtc(schedule.effectiveTo as string, schedule.timeZone) : null;
  if ((hasFrom && fromUtc === null) || (hasTo && toUtc === null)) {
    return { ...base, status: 'invalid', enforced: true, reason: '生效/失效时间或时区无法解析，按有效处理' };
  }

  const report = {
    ...base,
    effectiveFromUtc: fromUtc !== null ? new Date(fromUtc).toISOString() : undefined,
    effectiveToUtc: toUtc !== null ? new Date(toUtc).toISOString() : undefined
  };
  const from = fromUtc ?? Number.NEGATIVE_INFINITY;
  const to = toUtc ?? Number.POSITIVE_INFINITY;

  if (from >= to) {
    return { ...report, status: 'invalid', enforced: true, reason: '失效时间不晚于生效时间，时间范围无效，按有效处理' };
  }
  if (departureUtcMs < from) {
    return { ...report, status: 'not-yet-active', enforced: false, reason: `起飞时刻早于生效时间（${formatUtc(from)} 起生效），本次不拦截` };
  }
  if (departureUtcMs >= to) {
    return { ...report, status: 'expired', enforced: false, reason: `生效窗口已于 ${formatUtc(to)} 结束，本次不拦截` };
  }
  return { ...report, status: 'active', enforced: true, reason: '起飞时刻处于生效窗口内' };
}
