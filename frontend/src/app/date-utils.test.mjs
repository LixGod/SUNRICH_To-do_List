import test from 'node:test';
import assert from 'node:assert/strict';
import { addMonthsIso, compareTaskStack, monthGridSize, parseSmartOmnibar, plannerTodayIso, resolveNavPrefs, taskOnDate } from './date-utils.ts';

test('month navigation stays in the next month and clamps short months', () => {
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsIso('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonthsIso('2026-03-31', -1), '2026-02-28');
});

test('month grid includes every day in a six-week month', () => {
  assert.equal(monthGridSize(2026, 8), 42);
  assert.equal(monthGridSize(2026, 2), 35);
});

test('planner today uses the business time zone', () => {
  assert.equal(plannerTodayIso(new Date('2026-10-29T19:00:00Z')), '2026-10-30');
});

test('smart omnibar parses priority, category, and focus', () => {
  const res = parseSmartOmnibar('Finalize Q4 Capital Review !High #Finance *Focus', 'MEDIUM');
  assert.equal(res.title, 'Finalize Q4 Capital Review');
  assert.equal(res.priority, 'HIGH');
  assert.equal(res.category, 'Finance');
  assert.equal(res.pinFocus, true);
});

test('smart omnibar leaves command-like text inside an email address alone', () => {
  const parsed = parseSmartOmnibar('Email alice@today.com about renewal', 'LOW');
  assert.equal(parsed.title, 'Email alice@today.com about renewal');
  const literal = parseSmartOmnibar('Review ISSUE#123 and x!high draft', 'LOW');
  assert.equal(literal.title, 'Review ISSUE#123 and x!high draft');
  assert.equal(literal.priority, 'LOW');
  assert.equal(literal.category, '');
  const punctuated = parseSmartOmnibar('Review !high', 'LOW');
  assert.equal(punctuated.priority, 'HIGH');
});

test('unfinished tasks carry forward and completed tasks appear on the Kolkata completion day', () => {
  const task = { status: 'ACTIVE', updatedAt: '2026-11-01T12:00:00Z' };
  assert.equal(taskOnDate(task, '2026-11-02', '2026-11-03'), false);
  assert.equal(taskOnDate(task, '2026-11-03', '2026-11-03'), true);
  task.status = 'COMPLETED';
  task.completedAt = '2026-11-02T19:00:00Z';
  assert.equal(taskOnDate(task, '2026-11-03', '2026-11-03'), true);
  assert.equal(taskOnDate(task, '2026-11-02', '2026-11-03'), false);
});

test('stack sorting places focused tasks above High priority, then High -> Medium -> Low', () => {
  const items = [
    { id: 1, priority: 'LOW', status: 'ACTIVE', focusDate: null },
    { id: 2, priority: 'HIGH', status: 'ACTIVE', focusDate: null },
    { id: 3, priority: 'MEDIUM', status: 'ACTIVE', focusDate: '2026-10-30' },
    { id: 4, priority: 'MEDIUM', status: 'ACTIVE', focusDate: null }
  ];
  const sorted = [...items].sort((a, b) => compareTaskStack(a, b, '2026-10-30'));
  assert.deepEqual(sorted.map(i => i.id), [3, 2, 4, 1]);
});

test('resolveNavPrefs normalizes login tab, visible workspace tabs, and label mode', () => {
  const defaults = resolveNavPrefs(null, null, null);
  assert.equal(defaults.defaultTab, 'my-day');
  assert.deepEqual(defaults.visibleTabs, ['my-day', 'my-tasks', 'kanban']);
  assert.equal(defaults.showLabels, true);

  const custom = resolveNavPrefs('kanban', 'kanban,my-tasks', 'logo-only');
  assert.equal(custom.defaultTab, 'kanban');
  assert.deepEqual(custom.visibleTabs, ['my-tasks', 'kanban']);
  assert.equal(custom.showLabels, false);

  const fallback = resolveNavPrefs('my-day', 'kanban', 'full');
  assert.equal(fallback.defaultTab, 'kanban');
  assert.deepEqual(fallback.visibleTabs, ['kanban']);
  assert.equal(fallback.showLabels, true);
});
