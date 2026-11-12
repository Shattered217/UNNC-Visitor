import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { defaultConfig, isWorkday, beforeWorkdays, renewalPlan, type Calendars } from '../src/renewal.ts';
const calendars: Calendars = {};
for (const year of [2025, 2026, 2027]) calendars[year] = JSON.parse(readFileSync(new URL(`../calendar/${year}.json`, import.meta.url), 'utf8'));
const config = { ...defaultConfig, gate: '10001', purpose: '培训', hostEmail: 'fixture@nottingham.edu.cn' };
const limits = { maxSpanDays: 16, maxAdvanceDays: 15, banToday: false, banWeek: [], banDates: [] };
const record = { Vbranch: config.gate, Vpurpose: config.purpose, Eemail: config.hostEmail, Vdate: 20261114, approved: 0 };
const at = (date: string, hour = '09') => Date.parse(`${date}T${hour}:00:00+08:00`);

test('China workdays honor the published holidays and makeup weekends', () => {
  for (const calendar of Object.values(calendars)) for (const day of calendar.days) assert.equal(isWorkday(day.date, 'china', calendars), !day.isOffDay);
  assert.equal(isWorkday('2026-01-04', 'china', calendars), true);
  assert.equal(isWorkday('2026-01-04', 'weekdays', calendars), false);
  assert.equal(isWorkday('2026-10-01', 'china', calendars), false);
  assert.equal(beforeWorkdays('2026-11-14', 3, 'china', calendars), '2026-11-11');
  assert.equal(beforeWorkdays('2026-01-05', 1, 'china', calendars), '2026-01-04');
});
test('renewal waits until the Beijing workday and configured hour', () => {
  assert.equal(renewalPlan([record], config, limits, calendars, at('2026-11-09')).state, 'waiting');
  assert.equal(renewalPlan([record], config, limits, calendars, at('2026-11-11', '08')).state, 'waiting');
  assert.equal(renewalPlan([record], config, limits, calendars, at('2026-11-11')).state, 'ready');
  assert.equal(renewalPlan([record], config, limits, calendars, at('2026-11-15')).state, 'waiting');
});
test('maximum span and continuation both honor the school advance window', () => {
  const plan = renewalPlan([record], config, limits, calendars, at('2026-11-11'));
  assert.equal(plan.start, '2026-11-11'); assert.equal(plan.end, '2026-11-26');
  const continued = renewalPlan([record], { ...config, dateMode: 'after_expiry' }, limits, calendars, at('2026-11-11'));
  assert.equal(continued.start, '2026-11-15'); assert.equal(continued.end, '2026-11-26');
});
test('pending or fully covered visits suppress duplicate submissions; other hosts do not extend coverage', () => {
  for (const approved of [100, 2]) assert.equal(renewalPlan([record, { ...record, Vdate: 20261126, approved }], config, limits, calendars, at('2026-11-11')).state, 'pending_approval');
  assert.equal(renewalPlan([{ ...record, Vdate: 20261126 }], { ...config, leadWorkdays: 10 }, limits, calendars, at('2026-11-11')).state, 'waiting');
  assert.equal(renewalPlan([{ ...record, Eemail: 'another@nottingham.edu.cn' }], config, limits, calendars, at('2026-11-11')).expiry, null);
});
test('missing calendar and impossible school rules prevent booking', () => {
  assert.equal(renewalPlan([], config, limits, {}, at('2026-11-11')).state, 'calendar_missing');
  assert.equal(renewalPlan([], config, { ...limits, banWeek: [0, 1, 2, 3, 4, 5, 6] }, calendars, at('2026-11-11')).state, 'school_limit');
  assert.equal(renewalPlan([], { ...config, enabled: false }, limits, calendars, at('2026-11-11')).state, 'disabled');
  const oneDay = renewalPlan([], config, { ...limits, maxSpanDays: 1, maxAdvanceDays: 0 }, calendars, at('2026-11-11'));
  assert.equal(oneDay.state, 'ready'); assert.equal(oneDay.start, oneDay.end);
});
