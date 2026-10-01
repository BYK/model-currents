import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFlowSvg } from '../src/flow-svg/renderer.ts';
import { getModelColor, OTHER_MODEL_COLOR } from '../src/model-colors.ts';
import { clampEndDay, clampStartDay, panDateRange, zoomDateRange } from '../src/timeline-zoom.ts';

const january = Date.UTC(2025, 0, 1);
const february = Date.UTC(2025, 1, 1);
const august = Date.UTC(2025, 7, 1);
const chartOptions = { start: january, end: august, width: 1200, height: 640 };

const render = (data, options = {}) => renderFlowSvg(data, { ...chartOptions, ...options });

function continuityBand(svg) {
    const path = svg.match(/<path class="continuity-ribbon" d="([^"]+)"/);
    assert.ok(path, 'expected a real same-model continuity stream');
    const coordinates = path[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    return coordinates[15] - coordinates[1];
}

function continuityEndBand(svg) {
    const path = svg.match(/<path class="continuity-ribbon" d="([^"]+)"/);
    assert.ok(path, 'expected a real same-model continuity stream');
    const coordinates = path[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    return coordinates[9] - coordinates[5];
}

function continuityBands(svg) {
    return [...svg.matchAll(/<path class="continuity-ribbon" d="([^"]+)"/g)].map((path) => {
        const coordinates = path[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
        return [coordinates[15] - coordinates[1], coordinates[9] - coordinates[5]];
    });
}

test('same-model continuity resizes to activity in each adjacent period', () => {
    const svg = render([
        { time: january + 86_400_000, to: 'model-a', weight: 4 },
        { time: february + 86_400_000, to: 'model-a', weight: 10 },
    ]);

    assert.match(svg, /data-flow-plot-start-x=/);
    assert.ok(Math.abs(continuityBand(svg) - (4 * (chartOptions.height - 96)) / 10) < 0.001);
    assert.ok(Math.abs(continuityEndBand(svg) - (10 * (chartOptions.height - 96)) / 10) < 0.001);
});

test('grouped categories connect only the underlying models present in both periods', () => {
    const grouped = { displayKey: () => 'Other models' };
    const differentModels = render([
        { time: january + 86_400_000, to: 'model-a' },
        { time: february + 86_400_000, to: 'model-b' },
    ], grouped);
    assert.doesNotMatch(differentModels, /class="continuity-ribbon"/);

    const sharedModels = render([
        { time: january + 86_400_000, to: 'model-a', weight: 3 },
        { time: january + 86_400_000, to: 'model-b', weight: 1 },
        { time: february + 86_400_000, to: 'model-a', weight: 1 },
        { time: february + 86_400_000, to: 'model-b', weight: 3 },
    ], grouped);
    const scale = (chartOptions.height - 96) / 4;
    assert.deepEqual(continuityBands(sharedModels), [[3 * scale, scale], [scale, 3 * scale]]);
});

test('entry marks and hover data move onto a matching continuity stream', () => {
    const svg = render([
        { time: january + 86_400_000, to: 'model-a', weight: 4 },
        { time: february + 86_400_000, to: 'model-a', weight: 10 },
    ]);

    assert.equal((svg.match(/class="flow-entry-block"/g) ?? []).length, 1);
    assert.equal((svg.match(/class="flow-ribbon flow-entry"/g) ?? []).length, 1);
    assert.match(svg, /class="continuity-ribbon"[^>]*data-flow-pairs="[^\"]*\[null,&quot;model-a&quot;\][^\"]*"[^>]*><title>[^<]*10 into model-a/);
});

test('entry marks move onto an observed incoming stream, while unmatched grouped models keep theirs', () => {
    const switchSvg = render([
        { time: january + 86_400_000, to: 'model-a' },
        { time: february + 86_400_000, to: 'model-a' },
        { time: february + 2 * 86_400_000, to: 'model-b', from: 'model-a', fromTime: february + 86_400_000 },
        { time: february + 3 * 86_400_000, to: 'model-b' },
    ]);
    assert.match(switchSvg, /flow-intra[^>]*data-flow-pairs="[^\"]*\[null,&quot;model-b&quot;\][^\"]*"[^>]*><title>[^<]*into model-b/);
    assert.equal((switchSvg.match(/class="flow-entry-block"/g) ?? []).length, 1);

    const groupedSvg = render([
        { time: january + 86_400_000, to: 'model-a' },
        { time: february + 86_400_000, to: 'model-b' },
    ], { displayKey: () => 'Other models' });
    assert.doesNotMatch(groupedSvg, /class="continuity-ribbon"/);
    assert.equal((groupedSvg.match(/class="flow-entry-block"/g) ?? []).length, 2);
});

test('grouped hidden-model switches do not become self-loops, while their continuity stays model-specific', () => {
    const svg = render([
        { time: january + 86_400_000, to: 'model-a' },
        { time: january + 2 * 86_400_000, to: 'model-b', from: 'model-a', fromTime: january + 86_400_000 },
        { time: february + 86_400_000, to: 'model-a' },
        { time: february + 2 * 86_400_000, to: 'model-b', from: 'model-a', fromTime: february + 86_400_000 },
    ], { displayKey: () => 'Other models' });

    assert.equal((svg.match(/class="usage-node"/g) ?? []).length, 2);
    assert.equal((svg.match(/class="flow-ribbon flow-intra"/g) ?? []).length, 0);
    assert.equal(continuityBands(svg).length, 2);
    assert.match(svg, /Visual continuity: model-a/);
    assert.match(svg, /Visual continuity: model-b/);
});

test('known providers and model families keep stable colors across model versions and routes', () => {
    const opus = getModelColor('anthropic/claude-opus-4');
    const sonnet = getModelColor('anthropic/claude-3-7-sonnet');
    const haiku = getModelColor('anthropic/claude-3-5-haiku');
    assert.equal(getModelColor('openrouter/anthropic/claude-opus-4-1'), opus);
    assert.notEqual(opus, sonnet);
    assert.notEqual(sonnet, haiku);
    assert.equal(getModelColor('openai/gpt-4o'), getModelColor('openai/gpt-5'));
    assert.equal(getModelColor('openai/gpt-4o'), getModelColor('openrouter/openai/gpt-4o'));
    assert.notEqual(getModelColor('openai/gpt-5'), opus);
    assert.notEqual(getModelColor('openai/gpt-5'), getModelColor('openai/gpt-5-codex'));
    assert.notEqual(getModelColor('openai/gpt-5'), getModelColor('openai/o3'));
    assert.notEqual(getModelColor('google/gemini-2.5-pro'), getModelColor('google/gemini-2.5-flash'));
    assert.notEqual(getModelColor('mistral/large'), getModelColor('mistral/codestral'));
    assert.equal(getModelColor('other-provider/model-1'), getModelColor('other-provider/model-2'));
    assert.equal(getModelColor('Other models'), OTHER_MODEL_COLOR);
});

test('grouped model streams keep their family colors while the aggregate node stays neutral', () => {
    const svg = render([
        { time: january + 86_400_000, to: 'anthropic/claude-opus-4' },
        { time: february + 86_400_000, to: 'anthropic/claude-opus-4' },
        { time: january + 2 * 86_400_000, to: 'anthropic/claude-3-7-sonnet' },
        { time: february + 2 * 86_400_000, to: 'anthropic/claude-3-7-sonnet' },
    ], {
        displayKey: () => 'Other models',
        colorFor: () => OTHER_MODEL_COLOR,
        streamColorFor: (model) => getModelColor(model),
    });

    assert.equal((svg.match(/class="usage-node"[^>]*fill="#728b93"/g) ?? []).length, 2);
    const continuityColors = [...svg.matchAll(/class="continuity-ribbon"[^>]*fill="([^"]+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(continuityColors, [
        getModelColor('anthropic/claude-opus-4'),
        getModelColor('anthropic/claude-3-7-sonnet'),
    ].sort());
});

test('wheel zoom preserves its date under the pointer and reverses to zoom out', () => {
    const range = { minDay: 0, maxDay: 99, startDay: 10, endDay: 89 };
    const anchor = { day: 50, position: 0.75 };
    const zoomed = zoomDateRange(range, 0.5, anchor);

    assert.ok(zoomed);
    assert.ok(Math.abs((anchor.day - zoomed.startDay) / (zoomed.endDay - zoomed.startDay) - anchor.position) < 0.02);

    const widened = zoomDateRange({ ...range, ...zoomed }, 2, anchor);
    assert.ok(widened);
    assert.ok(widened.endDay - widened.startDay > zoomed.endDay - zoomed.startDay);
    assert.deepEqual(zoomDateRange(range, 100), { startDay: range.minDay, endDay: range.maxDay });
    assert.deepEqual(
        zoomDateRange({ ...range, startDay: 0, endDay: 39 }, 0.5, { day: 0, position: 0 }),
        { startDay: 0, endDay: 19 },
    );
    assert.equal(zoomDateRange({ ...range, startDay: 10, endDay: 11 }, 0.5), null);
});

test('drag panning shifts the window without changing its duration or crossing data bounds', () => {
    const range = { minDay: 0, maxDay: 99, startDay: 20, endDay: 59 };

    assert.deepEqual(panDateRange(range, 10), { startDay: 30, endDay: 69 });
    assert.deepEqual(panDateRange(range, -50), { startDay: 0, endDay: 39 });
    assert.deepEqual(panDateRange(range, 50), { startDay: 60, endDay: 99 });
    assert.equal(panDateRange(range, 0), null);
    assert.equal(panDateRange(range, Number.NaN), null);
});

test('timeline slider values clamp at the other handle without changing the shared scale', () => {
    assert.equal(clampStartDay(100, 0, 50), 49);
    assert.equal(clampStartDay(-10, 0, 50), 0);
    assert.equal(clampEndDay(-10, 20, 50), 21);
    assert.equal(clampEndDay(100, 20, 50), 50);
});
