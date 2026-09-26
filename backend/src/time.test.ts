import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateZoneTime, parseInstant, summarizeZoneTimes } from './time.js';
import { validateRoute } from './geometry.js';
import type { NoFlyZone, RoutePlan } from './types.js';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

function zoneWith(windows: NoFlyZone['timeWindows']): NoFlyZone {
  return {
    id: 'zone-1',
    name: '测试区',
    kind: 'rectangle',
    points: [
      { x: 40, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 35 },
      { x: 40, y: 35 }
    ],
    timeWindows: windows
  };
}

test('跨午夜窗口：起飞在当日深夜与次日凌晨均生效，窗口外不生效', () => {
  const zone = zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH, source: 'NOTAM A1' }]);
  assert.equal(evaluateZoneTime(zone, '2026-09-26T23:30:00+08:00').status, 'active');
  assert.equal(evaluateZoneTime(zone, '2026-09-27T01:30:00+08:00').status, 'active');
  assert.equal(evaluateZoneTime(zone, '2026-09-27T03:00:00+08:00').status, 'inactive');
  assert.equal(evaluateZoneTime(zone, '2026-09-26T21:00:00+08:00').status, 'inactive');
});

test('边界时刻为半开区间：等于生效时间有效，等于失效时间失效', () => {
  const zone = zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH }]);
  assert.equal(evaluateZoneTime(zone, '2026-09-26T22:00:00+08:00').status, 'active');
  assert.equal(evaluateZoneTime(zone, '2026-09-27T02:00:00+08:00').status, 'inactive');
});

test('夏令时空档：不存在的本地时间顺延到下一个有效时刻', () => {
  // 2026-03-08 美国东部 02:00-03:00 不存在，02:30 应顺延为 03:00 EDT = 07:00Z
  const parsed = parseInstant('2026-03-08T02:30', NY, '生效时间');
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.instant, Date.parse('2026-03-08T07:00:00Z'));
    assert.equal(parsed.notes.length, 1);
  }
});

test('夏令时回拨：重复的本地时间取第一次出现', () => {
  // 2026-11-01 01:30 在美东出现两次，应取较早的 05:30Z（EDT）
  const parsed = parseInstant('2026-11-01T01:30', NY, '生效时间');
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.instant, Date.parse('2026-11-01T05:30:00Z'));
    assert.equal(parsed.notes.length, 1);
  }
});

test('无效时间范围：失效早于生效应判为无法确认而不是已过期', () => {
  const zone = zoneWith([{ effectiveFrom: '2026-09-27T02:00', effectiveUntil: '2026-09-26T22:00', timezone: SH }]);
  const evaluation = evaluateZoneTime(zone, '2026-09-26T23:00:00+08:00');
  assert.equal(evaluation.status, 'unknown');
  assert.ok(evaluation.reasons.some((reason) => reason.includes('时间范围无效')));
});

test('缺少时区的本地时间使窗口无效；显式偏移则无需时区', () => {
  const naive = zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00' }]);
  assert.equal(evaluateZoneTime(naive, '2026-09-26T23:00:00+08:00').status, 'unknown');
  const offset = zoneWith([{ effectiveFrom: '2026-09-26T22:00:00+08:00', effectiveUntil: '2026-09-27T02:00:00+08:00' }]);
  assert.equal(evaluateZoneTime(offset, '2026-09-26T23:00:00+08:00').status, 'active');
});

test('无法识别的时区与不存在的日期都使窗口无效', () => {
  const badZone = zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: 'Mars/Olympus' }]);
  assert.equal(evaluateZoneTime(badZone, '2026-09-26T23:00:00+08:00').status, 'unknown');
  const badDate = zoneWith([{ effectiveFrom: '2026-02-30T10:00', effectiveUntil: '2026-09-27T02:00', timezone: SH }]);
  assert.equal(evaluateZoneTime(badDate, '2026-09-26T23:00:00+08:00').status, 'unknown');
});

test('多个来源重叠：任一窗口生效则区域生效，并列出全部生效来源', () => {
  const zone = zoneWith([
    { effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH, source: 'NOTAM A' },
    { effectiveFrom: '2026-09-26T23:00', effectiveUntil: '2026-09-27T03:00', timezone: SH, source: 'NOTAM B' },
    { effectiveFrom: '2026-09-20T08:00', effectiveUntil: '2026-09-21T08:00', timezone: SH, source: '演练（已结束）' }
  ]);
  const evaluation = evaluateZoneTime(zone, '2026-09-26T23:30:00+08:00');
  assert.equal(evaluation.status, 'active');
  assert.deepEqual(evaluation.activeSources, ['NOTAM A', 'NOTAM B']);
});

test('生效窗口与无效窗口并存时，生效结论仍然确定', () => {
  const zone = zoneWith([
    { effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH, source: 'NOTAM A' },
    { effectiveFrom: 'bad-time', effectiveUntil: '2026-09-27T02:00', timezone: SH, source: '损坏的数据' }
  ]);
  assert.equal(evaluateZoneTime(zone, '2026-09-26T23:30:00+08:00').status, 'active');
  // 没有任何生效窗口时，无效窗口把结果拉向 unknown 而不是 inactive
  const onlyBroken = zoneWith([{ effectiveFrom: 'bad-time', effectiveUntil: '2026-09-27T02:00', timezone: SH }]);
  assert.equal(evaluateZoneTime(onlyBroken, '2026-09-26T23:30:00+08:00').status, 'unknown');
});

test('开放窗口：只写一端表示该方向不限；空窗口无效', () => {
  const fromOnly = zoneWith([{ effectiveFrom: '2026-09-26T22:00', timezone: SH }]);
  assert.equal(evaluateZoneTime(fromOnly, '2030-01-01T00:00:00+08:00').status, 'active');
  const untilOnly = zoneWith([{ effectiveUntil: '2026-09-27T02:00', timezone: SH }]);
  assert.equal(evaluateZoneTime(untilOnly, '2026-09-26T23:00:00+08:00').status, 'active');
  assert.equal(evaluateZoneTime(untilOnly, '2026-09-28T00:00:00+08:00').status, 'inactive');
  const empty = zoneWith([{ timezone: SH }]);
  assert.equal(evaluateZoneTime(empty, '2026-09-26T23:00:00+08:00').status, 'unknown');
});

test('未配置时间的区域与未设置起飞时间都必须是无法确认，而不是永久有效', () => {
  const legacy = zoneWith(undefined);
  const noDeparture = evaluateZoneTime(legacy, undefined);
  assert.equal(noDeparture.status, 'unknown');
  assert.ok(noDeparture.reasons[0].includes('未配置生效时间'));
  const windowed = zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH }]);
  const missing = evaluateZoneTime(windowed, undefined);
  assert.equal(missing.status, 'unknown');
  assert.ok(missing.reasons[0].includes('未设置计划起飞时间'));
  const naiveDeparture = evaluateZoneTime(windowed, '2026-09-26T23:00');
  assert.equal(naiveDeparture.status, 'unknown');
});

function planWith(zone: NoFlyZone, departureTime?: string): RoutePlan {
  return {
    id: 'p1',
    name: '测试方案',
    createdAt: '',
    updatedAt: '',
    canvas: { width: 100, height: 70 },
    start: { x: 10, y: 10 },
    end: { x: 90, y: 30 },
    waypoints: [],
    noFlyZones: [zone],
    departureTime
  };
}

test('validateRoute：按起飞时刻区分生效、过期与无法确认', () => {
  const windowed = zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH, source: 'NOTAM A' }]);
  // 生效中：穿越 → 无效，进入 active 桶
  const during = validateRoute(planWith(windowed, '2026-09-26T23:30:00+08:00'));
  assert.equal(during.valid, false);
  assert.equal(during.issues[0].type, 'no-fly-zone');
  assert.equal(during.zones.active.length, 1);
  // 已过期：穿越 → 有效，进入 inactive 桶
  const after = validateRoute(planWith(windowed, '2026-09-27T08:00:00+08:00'));
  assert.equal(after.valid, true);
  assert.equal(after.issues.length, 0);
  assert.equal(after.zones.inactive.length, 1);
  // 旧方案（无时间信息）：穿越 → 保守判无效，进入 unknown 桶并明确标注
  const legacy = validateRoute(planWith(zoneWith(undefined), '2026-09-26T23:30:00+08:00'));
  assert.equal(legacy.valid, false);
  assert.equal(legacy.issues[0].type, 'no-fly-zone-unconfirmed');
  assert.equal(legacy.zones.unknown.length, 1);
  // 未设置起飞时间：带窗口的区域同样无法确认
  const noTime = validateRoute(planWith(windowed, undefined));
  assert.equal(noTime.valid, false);
  assert.equal(noTime.issues[0].type, 'no-fly-zone-unconfirmed');
});

test('summarizeZoneTimes 分桶完整且互不重叠', () => {
  const zones = [
    { ...zoneWith([{ effectiveFrom: '2026-09-26T22:00', effectiveUntil: '2026-09-27T02:00', timezone: SH }]), id: 'a', name: '生效区' },
    { ...zoneWith([{ effectiveFrom: '2026-09-20T08:00', effectiveUntil: '2026-09-21T08:00', timezone: SH }]), id: 'b', name: '过期区' },
    { ...zoneWith(undefined), id: 'c', name: '旧数据区' }
  ];
  const summary = summarizeZoneTimes(zones, '2026-09-26T23:30:00+08:00');
  assert.deepEqual(summary.active.map((e) => e.zoneId), ['a']);
  assert.deepEqual(summary.inactive.map((e) => e.zoneId), ['b']);
  assert.deepEqual(summary.unknown.map((e) => e.zoneId), ['c']);
});
