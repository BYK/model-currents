import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDemoUsage } from '../src/demo-usage.ts';
import { parseUsageDocument } from '../src/usage-data.ts';

const DAY = 86_400_000;

test('mock history is valid, repeatable, and varies across days and weeks', () => {
    const document = makeDemoUsage();
    assert.deepEqual(document, makeDemoUsage());
    assert.deepEqual(parseUsageDocument(document), document);
    assert.equal(document.source, 'example');

    const starts = document.events.filter((event) => event.kind === 'session');
    const switches = document.events.filter((event) => event.kind === 'switch');
    assert.ok(starts.length >= 60);
    assert.ok(switches.length >= 10);
    assert.ok(document.events.every((event) => Object.keys(event).every((key) =>
        ['time', 'model', 'kind', 'fromModel', 'fromTime'].includes(key))));
    assert.ok(switches.every((event) => starts.some((start) =>
        start.time === event.fromTime && start.model === event.fromModel && start.time < event.time)));

    const firstDay = Math.floor(Math.min(...starts.map((event) => event.time)) / DAY);
    const dayCounts = new Map();
    const weekCounts = new Map();
    for (const event of starts) {
        const day = Math.floor(event.time / DAY) - firstDay;
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
        const week = Math.floor(day / 7);
        weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
    }
    const days = [...dayCounts.keys()].sort((a, b) => a - b);
    const gaps = days.slice(1).map((day, index) => day - days[index]);
    assert.ok(new Set(gaps).size >= 3, 'sessions should not land at fixed intervals');
    assert.ok(new Set(dayCounts.values()).size >= 3, 'daily volume should vary');
    assert.ok(new Set(weekCounts.values()).size >= 4, 'weekly volume should vary');
    assert.ok(Math.max(...gaps) >= 5, 'include a quiet spell');
});
