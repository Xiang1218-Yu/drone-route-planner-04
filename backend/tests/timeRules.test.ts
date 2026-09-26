import assert from 'node:assert/strict';
import { validateRoute } from '../src/geometry.js';
import { evaluateZoneSchedule, parseLocalDateTime, resolveDepartureInstant, zonedTimeToUtc } from '../src/timeRules.js';
import type { NoFlyZone, RoutePlan, ZoneSchedule } from '../src/types.js';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const makeZone = (id: string, schedule?: ZoneSchedule): NoFlyZone => ({
  id,
  name: id,
  kind: 'rectangle',
  points: [{ x: 40, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 35 }, { x: 40, y: 35 }],
  schedule
});

const makePlan = (noFlyZones: NoFlyZone[], departureTime?: string, departureTimeZone?: string): RoutePlan => ({
  id: 'plan-test',
  name: '测试方案',
  createdAt: '',
  updatedAt: '',
  canvas: { width: 100, height: 70 },
  start: { x: 10, y: 27 },
  end: { x: 90, y: 27 },
  waypoints: [],
  noFlyZones,
  departureTime,
  departureTimeZone
});

const SHANGHAI = 'Asia/Shanghai';
const at = (local: string, timeZone = SHANGHAI) => {
  const utc = zonedTimeToUtc(local, timeZone);
  assert.notEqual(utc, null, `应能解析 ${local} (${timeZone})`);
  return utc as number;
};

// ---------- 基础解析 ----------
test('datetime-local 解析：合法时间、拒绝不存在的日期与错误格式', () => {
  assert.equal(parseLocalDateTime('2026-09-26T08:00'), Date.UTC(2026, 8, 26, 8, 0));
  assert.equal(parseLocalDateTime('2026-02-31T10:00'), null);
  assert.equal(parseLocalDateTime('2026-13-01T00:00'), null);
  assert.equal(parseLocalDateTime('2026-09-26T25:00'), null);
  assert.equal(parseLocalDateTime('not-a-time'), null);
});

test('时区换算：Asia/Shanghai 固定 +8，无法识别的时区返回 null', () => {
  assert.equal(zonedTimeToUtc('2026-09-26T22:00', SHANGHAI), Date.UTC(2026, 8, 26, 14, 0));
  assert.equal(zonedTimeToUtc('2026-09-26T22:00', 'UTC'), Date.UTC(2026, 8, 26, 22, 0));
  assert.equal(zonedTimeToUtc('2026-09-26T22:00', 'Mars/Olympus'), null);
});

// ---------- 夏令时 ----------
test('夏令时拨快：不存在的 02:30 顺延到第一个真实时刻 03:00 EDT', () => {
  // 2026-03-08 纽约 02:00 拨快到 03:00，02:30 不存在
  assert.equal(zonedTimeToUtc('2026-03-08T02:30', 'America/New_York'), Date.UTC(2026, 2, 8, 7, 0));
});

test('夏令时回拨：重复的 01:30 固定取第一次出现（EDT，UTC-4）', () => {
  // 2026-11-01 纽约 02:00 回拨到 01:00，01:30 出现两次
  assert.equal(zonedTimeToUtc('2026-11-01T01:30', 'America/New_York'), Date.UTC(2026, 10, 1, 5, 30));
});

test('夏令时切换当天的窗口判定无歧义', () => {
  const zone = makeZone('dst', { effectiveFrom: '2026-03-08T01:30', effectiveTo: '2026-03-08T03:30', timeZone: 'America/New_York' });
  // 窗口为 UTC 06:30 – 07:30
  assert.equal(evaluateZoneSchedule(zone, Date.UTC(2026, 2, 8, 7, 0)).status, 'active');
  assert.equal(evaluateZoneSchedule(zone, Date.UTC(2026, 2, 8, 8, 0)).status, 'expired');
});

// ---------- 跨午夜与边界 ----------
test('跨午夜窗口：22:00 至次日 02:00 的判定', () => {
  const zone = makeZone('night', { effectiveFrom: '2026-09-26T22:00', effectiveTo: '2026-09-27T02:00', timeZone: SHANGHAI });
  assert.equal(evaluateZoneSchedule(zone, at('2026-09-26T23:30')).status, 'active');
  assert.equal(evaluateZoneSchedule(zone, at('2026-09-27T01:00')).status, 'active');
  assert.equal(evaluateZoneSchedule(zone, at('2026-09-27T03:00')).status, 'expired');
});

test('边界时刻：生效含边界、失效不含边界', () => {
  const zone = makeZone('edge', { effectiveFrom: '2026-09-26T22:00', effectiveTo: '2026-09-27T02:00', timeZone: SHANGHAI });
  assert.equal(evaluateZoneSchedule(zone, at('2026-09-26T22:00')).status, 'active');
  assert.equal(evaluateZoneSchedule(zone, at('2026-09-27T02:00')).status, 'expired');
  assert.equal(evaluateZoneSchedule(zone, at('2026-09-26T21:59')).status, 'not-yet-active');
});

// ---------- 无效与缺失 ----------
test('无效时间范围：失效早于或等于生效一律判 invalid 且按有效处理', () => {
  const reversed = makeZone('bad', { effectiveFrom: '2026-09-26T10:00', effectiveTo: '2026-09-26T08:00', timeZone: SHANGHAI });
  const empty = makeZone('empty', { effectiveFrom: '2026-09-26T08:00', effectiveTo: '2026-09-26T08:00', timeZone: SHANGHAI });
  for (const zone of [reversed, empty]) {
    const report = evaluateZoneSchedule(zone, at('2026-09-26T09:00'));
    assert.equal(report.status, 'invalid');
    assert.equal(report.enforced, true);
  }
});

test('缺失信息一律 unknown 且按有效处理，绝不静默当作永不过期', () => {
  const noSchedule = evaluateZoneSchedule(makeZone('legacy'), at('2026-09-26T08:00'));
  assert.equal(noSchedule.status, 'unknown');
  assert.equal(noSchedule.enforced, true);

  const noTimeZone = evaluateZoneSchedule(makeZone('no-tz', { effectiveFrom: '2026-09-26T08:00' }), at('2026-09-26T09:00'));
  assert.equal(noTimeZone.status, 'unknown');
  assert.equal(noTimeZone.enforced, true);

  const noDeparture = evaluateZoneSchedule(makeZone('no-dep', { effectiveFrom: '2026-09-26T08:00', timeZone: SHANGHAI }), null, '未设置起飞时间');
  assert.equal(noDeparture.status, 'unknown');
  assert.equal(noDeparture.enforced, true);
  assert.match(noDeparture.reason, /未设置起飞时间/);
});

test('无法解析的时间或时区判 invalid', () => {
  const badTime = evaluateZoneSchedule(makeZone('bad-time', { effectiveFrom: '2026-02-31T08:00', timeZone: SHANGHAI }), at('2026-09-26T08:00'));
  assert.equal(badTime.status, 'invalid');
  const badZone = evaluateZoneSchedule(makeZone('bad-zone', { effectiveFrom: '2026-09-26T08:00', timeZone: 'Mars/Olympus' }), at('2026-09-26T08:00'));
  assert.equal(badZone.status, 'invalid');
});

test('半开窗口：只设生效或只设失效', () => {
  const fromOnly = makeZone('from-only', { effectiveFrom: '2026-09-26T08:00', timeZone: SHANGHAI });
  assert.equal(evaluateZoneSchedule(fromOnly, at('2026-09-26T09:00')).status, 'active');
  assert.equal(evaluateZoneSchedule(fromOnly, at('2026-09-26T07:00')).status, 'not-yet-active');

  const toOnly = makeZone('to-only', { effectiveTo: '2026-09-26T18:00', timeZone: SHANGHAI });
  assert.equal(evaluateZoneSchedule(toOnly, at('2026-09-26T09:00')).status, 'active');
  assert.equal(evaluateZoneSchedule(toOnly, at('2026-09-26T19:00')).status, 'expired');
});

// ---------- 起飞时间解析 ----------
test('起飞时间解析：缺时间、缺时区、完整配置三种情况', () => {
  assert.match(resolveDepartureInstant({}).error ?? '', /未设置起飞时间/);
  assert.match(resolveDepartureInstant({ departureTime: '2026-09-26T08:00' }).error ?? '', /未标注时区/);
  const ok = resolveDepartureInstant({ departureTime: '2026-09-26T08:00', departureTimeZone: SHANGHAI });
  assert.equal(ok.instant?.utcMs, Date.UTC(2026, 8, 26, 0, 0));
});

// ---------- 路径校验集成 ----------
test('过期区域不拦截，有效区域拦截', () => {
  const expired = makeZone('expired', { effectiveFrom: '2026-09-25T08:00', effectiveTo: '2026-09-25T20:00', timeZone: SHANGHAI });
  const result = validateRoute(makePlan([expired], '2026-09-26T08:00', SHANGHAI));
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
  assert.equal(result.zoneTimeReports[0].status, 'expired');
  assert.equal(result.evaluatedAt, '2026-09-26T00:00:00.000Z');

  const active = makeZone('active', { effectiveFrom: '2026-09-26T06:00', effectiveTo: '2026-09-26T12:00', timeZone: SHANGHAI });
  const blocked = validateRoute(makePlan([active], '2026-09-26T08:00', SHANGHAI));
  assert.equal(blocked.valid, false);
  assert.equal(blocked.issues[0].timeStatus, 'active');
});

test('多个来源重叠：同一空域两个区域各自独立判定，结果无歧义', () => {
  const expiredNotice = makeZone('通告A', { effectiveFrom: '2026-09-25T00:00', effectiveTo: '2026-09-26T00:00', timeZone: SHANGHAI, source: 'NOTAM A0234/26' });
  const activeNotice = makeZone('通告B', { effectiveFrom: '2026-09-26T00:00', effectiveTo: '2026-09-27T00:00', timeZone: SHANGHAI, source: '临时管制通告 B' });
  const result = validateRoute(makePlan([expiredNotice, activeNotice], '2026-09-26T08:00', SHANGHAI));
  assert.equal(result.zoneTimeReports.length, 2);
  assert.equal(result.zoneTimeReports[0].status, 'expired');
  assert.equal(result.zoneTimeReports[1].status, 'active');
  const zoneIssues = result.issues.filter((issue) => issue.type === 'no-fly-zone');
  assert.equal(zoneIssues.length, 1);
  assert.equal(zoneIssues[0].zoneId, '通告B');
});

test('旧方案兼容：无时间信息、无起飞时间时仍拦截，并明确标注时效未确认', () => {
  const legacy = validateRoute(makePlan([makeZone('legacy-zone')]));
  assert.equal(legacy.valid, false);
  assert.equal(legacy.issues[0].timeStatus, 'unknown');
  assert.match(legacy.issues[0].message, /时效未确认，按有效处理/);
  assert.equal(legacy.zoneTimeReports[0].status, 'unknown');
  assert.equal(legacy.evaluatedAt, undefined);
});

console.log(`\n全部 ${passed} 项测试通过`);
