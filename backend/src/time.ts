import type { NoFlyZone, ZoneTimeEvaluation, ZoneTimeSummary, ZoneTimeWindow } from './types.js';

/**
 * 时间有效的空域规则：解析与判定逻辑（前后端各一份镜像，修改需同步）。
 *
 * 确定性约定：
 * - 窗口为半开区间 [effectiveFrom, effectiveUntil)：起飞时刻等于生效时间 → 有效；等于失效时间 → 已失效。
 * - 带显式偏移（Z 或 ±hh:mm）的时间直接按偏移解析，此时 timezone 仅作展示参考。
 * - 不带偏移的本地时间必须提供 IANA timezone；夏令时“空档”中不存在的本地时间顺延到下一个有效时刻，
 *   夏令时回拨导致的重复本地时间取第一次出现（较早的 UTC 瞬间），两种情况都会写入判定说明。
 * - 无效时间范围（失效 ≤ 生效）、无法识别的时区、缺少时区的本地时间，都使该窗口无效；
 *   区域存在无效窗口且没有任何生效窗口时，区域状态为 unknown，绝不按“已过期”或“永久有效”处理。
 */

const OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;

type ParsedInstant = { ok: true; instant: number; notes: string[] } | { ok: false; reason: string };

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  formatters.set(timezone, formatter);
  return formatter;
}

/** 指定 UTC 瞬间在该时区的墙钟时间，按“仿佛 UTC”重组为毫秒数（秒级精度） */
function wallClockAsUtcMs(instantMs: number, timezone: string): number {
  const parts = formatterFor(timezone).formatToParts(new Date(instantMs));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'));
}

/** 指定 UTC 瞬间该时区相对 UTC 的偏移（毫秒） */
function offsetMsAt(instantMs: number, timezone: string): number {
  const aligned = Math.floor(instantMs / 1000) * 1000;
  return wallClockAsUtcMs(aligned, timezone) - aligned;
}

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

/**
 * 把无时区偏移的本地时间解析为 UTC 瞬间。
 * 覆盖目标时刻前后各 26 小时采样偏移，所有能自洽回读的偏移都是候选：
 * 多个候选 = 夏令时回拨重复，取最早；无候选 = 夏令时空档，二分顺延到墙钟不小于目标的第一个瞬间。
 */
function resolveZonedLocal(parts: LocalParts, timezone: string): { instant: number; notes: string[] } {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  const offsets = new Set<number>();
  for (const probeHours of [-26, -13, 0, 13, 26]) {
    offsets.add(offsetMsAt(desired + probeHours * 3_600_000, timezone));
  }
  const candidates: number[] = [];
  for (const offset of offsets) {
    const instant = desired - offset;
    if (offsetMsAt(instant, timezone) === offset) candidates.push(instant);
  }
  candidates.sort((a, b) => a - b);
  if (candidates.length > 0) {
    const notes = candidates.length > 1 ? ['本地时间处于夏令时回拨的重复时段，已按第一次出现（较早时刻）解析'] : [];
    return { instant: candidates[0], notes };
  }
  let lo = Math.floor((desired - 48 * 3_600_000) / 1000);
  let hi = Math.ceil((desired + 48 * 3_600_000) / 1000);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallClockAsUtcMs(mid * 1000, timezone) >= desired) hi = mid;
    else lo = mid + 1;
  }
  return { instant: lo * 1000, notes: ['本地时间处于夏令时切换的空档中（不存在），已顺延到下一个有效时刻'] };
}

/** 解析单个时间端点；label 用于错误说明（如「生效时间」） */
export function parseInstant(raw: string | undefined, timezone: string | undefined, label: string): ParsedInstant {
  if (raw === undefined || raw.trim() === '') return { ok: false, reason: `${label}缺失` };
  const value = raw.trim();
  if (OFFSET_PATTERN.test(value)) {
    const instant = Date.parse(value);
    if (Number.isNaN(instant)) return { ok: false, reason: `${label}「${value}」不是有效的日期时间` };
    return { ok: true, instant, notes: [] };
  }
  const match = NAIVE_PATTERN.exec(value);
  if (!match) {
    return { ok: false, reason: `${label}「${value}」格式无效，应为 YYYY-MM-DDTHH:mm 或带时区偏移的 ISO 时间` };
  }
  const zone = timezone?.trim();
  if (!zone) return { ok: false, reason: `${label}「${value}」未携带时区偏移，且窗口未配置时区` };
  if (!isValidTimeZone(zone)) return { ok: false, reason: `时区「${zone}」无法识别` };
  const parts: LocalParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] ? Number(match[6]) : 0,
    millisecond: match[7] ? Number(match[7].padEnd(3, '0').slice(0, 3)) : 0
  };
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond));
  const validCalendar =
    probe.getUTCFullYear() === parts.year &&
    probe.getUTCMonth() === parts.month - 1 &&
    probe.getUTCDate() === parts.day &&
    probe.getUTCHours() === parts.hour &&
    probe.getUTCMinutes() === parts.minute &&
    probe.getUTCSeconds() === parts.second;
  if (!validCalendar) return { ok: false, reason: `${label}「${value}」不是真实存在的日期时间` };
  return { ok: true, ...resolveZonedLocal(parts, zone) };
}

/** 计划起飞时间必须带显式偏移，否则无法确定对应时刻 */
function parseDepartureTime(departureTime?: string): { ok: true; instant: number } | { ok: false; reason: string } {
  if (!departureTime || departureTime.trim() === '') {
    return { ok: false, reason: '未设置计划起飞时间，无法评估时间窗口' };
  }
  const value = departureTime.trim();
  if (!OFFSET_PATTERN.test(value)) {
    return { ok: false, reason: '计划起飞时间未携带时区偏移，无法确定对应时刻' };
  }
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return { ok: false, reason: `计划起飞时间「${value}」不是有效的日期时间` };
  return { ok: true, instant };
}

type WindowEvaluation = { ok: true; active: boolean; notes: string[] } | { ok: false; reason: string };

function evaluateWindow(window: ZoneTimeWindow, departureMs: number): WindowEvaluation {
  const hasFrom = Boolean(window.effectiveFrom?.trim());
  const hasUntil = Boolean(window.effectiveUntil?.trim());
  if (!hasFrom && !hasUntil) return { ok: false, reason: '窗口未配置生效与失效时间' };
  let from: number | undefined;
  let until: number | undefined;
  const notes: string[] = [];
  if (hasFrom) {
    const parsed = parseInstant(window.effectiveFrom, window.timezone, '生效时间');
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    from = parsed.instant;
    notes.push(...parsed.notes.map((note) => `生效${note}`));
  }
  if (hasUntil) {
    const parsed = parseInstant(window.effectiveUntil, window.timezone, '失效时间');
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    until = parsed.instant;
    notes.push(...parsed.notes.map((note) => `失效${note}`));
  }
  if (from !== undefined && until !== undefined && until <= from) {
    return { ok: false, reason: '失效时间早于或等于生效时间，时间范围无效' };
  }
  const active = (from === undefined || departureMs >= from) && (until === undefined || departureMs < until);
  return { ok: true, active, notes };
}

function describeWindow(window: ZoneTimeWindow, index: number): string {
  const source = window.source?.trim();
  const label = source ? `「${source}」` : `#${index + 1}`;
  const from = window.effectiveFrom?.trim() || '不限';
  const until = window.effectiveUntil?.trim() || '不限';
  const timezone = window.timezone?.trim();
  return `窗口${label}（${from} → ${until}${timezone ? `，${timezone}` : ''}）`;
}

/** 评估单个禁飞区在计划起飞时刻的时间状态 */
export function evaluateZoneTime(zone: NoFlyZone, departureTime?: string): ZoneTimeEvaluation {
  const windows = zone.timeWindows ?? [];
  const base = { zoneId: zone.id, zoneName: zone.name, windowCount: windows.length, activeSources: [] as string[] };
  if (windows.length === 0) {
    return { ...base, status: 'unknown', reasons: ['未配置生效时间，无法确认在起飞时刻是否有效'] };
  }
  const departure = parseDepartureTime(departureTime);
  if (!departure.ok) {
    return { ...base, status: 'unknown', reasons: [departure.reason] };
  }
  const reasons: string[] = [];
  const activeSources: string[] = [];
  let hasActive = false;
  let hasInvalid = false;
  windows.forEach((window, index) => {
    const description = describeWindow(window, index);
    const result = evaluateWindow(window, departure.instant);
    if (!result.ok) {
      hasInvalid = true;
      reasons.push(`${description}：${result.reason}`);
      return;
    }
    const noteText = result.notes.length > 0 ? `（${result.notes.join('；')}）` : '';
    if (result.active) {
      hasActive = true;
      activeSources.push(window.source?.trim() || `窗口 #${index + 1}`);
      reasons.push(`${description}：覆盖起飞时间，当前有效${noteText}`);
    } else {
      reasons.push(`${description}：不覆盖起飞时间${noteText}`);
    }
  });
  if (hasActive) return { ...base, status: 'active', reasons, activeSources };
  if (hasInvalid) return { ...base, status: 'unknown', reasons: [...reasons, '存在无效时间窗口，无法确认区域是否有效'] };
  return { ...base, status: 'inactive', reasons };
}

/** 对方案内所有禁飞区按起飞时刻分桶：当前有效 / 已过期或未生效 / 无法确认 */
export function summarizeZoneTimes(zones: NoFlyZone[], departureTime?: string): ZoneTimeSummary {
  const summary: ZoneTimeSummary = { active: [], inactive: [], unknown: [] };
  for (const zone of zones) {
    const evaluation = evaluateZoneTime(zone, departureTime);
    summary[evaluation.status].push(evaluation);
  }
  return summary;
}
