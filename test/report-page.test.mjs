import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('a shared report renders an explorable flow chart from public weekly counts, never raw history', async () => {
    const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const originalClipboardItem = globalThis.ClipboardItem;
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalWheelEvent = globalThis.WheelEvent;
    try {
        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        const element = () => ({ hidden: false, textContent: '', innerHTML: '', value: '', children: [], handlers: new Map(),
            clientWidth: 1200, clientHeight: 600, disabled: false,
            classList: { add() {}, remove() {}, toggle() {} },
            style: { setProperty() {} },
            append(child) { this.children.push(child); },
            replaceChildren(...children) { this.children = children; },
            setAttribute() {},
            addEventListener(type, handler) { this.handlers.set(type, handler); },
            getBoundingClientRect() { return { width: 1200, left: 0 }; },
            setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {},
        });
        const items = Object.fromEntries(['app', 'theme-toggle', 'report-status', 'chart-canvas', 'chart-scroll',
            'chart-message', 'timeline-controls', 'range-start', 'range-end', 'range-selection',
            'from-date', 'to-date', 'range-min-label', 'range-max-label', 'zoom-in', 'zoom-out', 'zoom-reset',
            'model-visibility', 'model-legend', 'show-models', 'report-share', 'share-x', 'share-bluesky',
            'copy-report-image', 'download-report-image', 'native-share-image', 'share-status'].map((name) => [name, element()]));
        items.app.querySelector = (selector) => items[selector.slice(1)];
        items['chart-canvas'].querySelector = (selector) => selector === 'svg.flow-svg' ? {
            getBoundingClientRect: () => ({ width: 1200, left: 0 }),
            viewBox: { baseVal: { width: 1200 } },
            dataset: { flowPlotStartX: '100', flowPlotEndX: '1100',
                flowPlotStartTime: String(Date.parse('2026-09-21T00:00:00Z')),
                flowPlotEndTime: String(Date.parse('2026-09-28T00:00:00Z')) },
        } : null;
        globalThis.document = {
            documentElement: { dataset: {} },
            querySelector: (selector) => selector === '#app' ? items.app : { content: '' },
            createDocumentFragment: element,
            createElement: element,
        };
        globalThis.window = {
            location: { pathname: `/u/${id}`, origin: 'https://modeltides.dev' },
            matchMedia: () => ({ matches: false, addEventListener() {} }),
            innerWidth: 1200, innerHeight: 800, addEventListener() {},
        };
        globalThis.ResizeObserver = class { observe() {} };
        globalThis.WheelEvent = { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };
        const copied = [];
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
            clipboard: { async write(items) { copied.push(...items); } },
        } });
        globalThis.ClipboardItem = class { constructor(contents) { this.contents = contents; } };
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            if (url === `/og/${id}.png`) return new Response(new Uint8Array([137, 80, 78, 71]),
                { headers: { 'Content-Type': 'image/png' } });
            return Response.json({ id, published: true, counts: [
                { week: '2026-09-21', model: '<img src=x onerror=alert(1)>', count: 2 },
                { week: '2026-09-28', model: 'openai/gpt-5', count: 1 },
                ...Array.from({ length: 6 }, (_, index) => ({ week: '2026-09-28', model: `example/model-${index}`, count: 1 })),
            ] });
        };
        await server.ssrLoadModule('/src/report-page.ts');
        await new Promise(setImmediate);
        assert.deepEqual(calls.map(({ url }) => url), [`/api/contributions/${id}`]);
        assert.equal(calls[0].options.cache, 'no-store');
        assert.match(items.app.innerHTML, /class="chart-card"/);
        assert.match(items.app.innerHTML, /class="range-track"/);
        assert.doesNotMatch(items.app.innerHTML, /View exact weekly counts|<table/);
        assert.match(items['chart-canvas'].innerHTML, /<svg/);
        assert.doesNotMatch(items['chart-canvas'].innerHTML, /<img src=x/);
        assert.match(items['chart-canvas'].innerHTML, /&lt;img src=x/);
        assert.match(items['chart-canvas'].innerHTML, /class="flow-ribbon flow-inferred"/);
        assert.match(items.app.innerHTML, /inferred shifts/i);
        assert.match(items['report-status'].textContent, /9 model uses/);
        assert.equal(items['timeline-controls'].hidden, false);
        assert.doesNotMatch(items.app.innerHTML, /href="\/local\/"/);
        assert.equal(new URL(items['share-x'].href).searchParams.get('url'), `https://modeltides.dev/u/${id}`);
        assert.match(new URL(items['share-bluesky'].href).searchParams.get('text'), /Your model tide.*https:\/\/modeltides\.dev\/u\//);
        assert.equal(items['show-models'].textContent, 'Show all 8');
        items['show-models'].handlers.get('click')();
        assert.equal(items['show-models'].textContent, 'Show top models');
        const wheel = { deltaY: -200, deltaX: 0, deltaMode: 0, clientX: 750,
            ctrlKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; } };
        items['chart-scroll'].handlers.get('wheel')(wheel);
        assert.equal(wheel.prevented, true);
        const zoomedStart = Number(items['range-start'].value);
        const zoomedEnd = Number(items['range-end'].value);
        assert.ok(zoomedEnd - zoomedStart < 7);
        const pan = { button: 0, pointerId: 1, clientX: 600, clientY: 200, preventDefault() {} };
        items['chart-scroll'].handlers.get('pointerdown')(pan);
        items['chart-scroll'].handlers.get('pointermove')({ ...pan, clientX: 800 });
        assert.equal(Number(items['range-end'].value) - Number(items['range-start'].value), zoomedEnd - zoomedStart);
        items['chart-scroll'].handlers.get('pointerup')(pan);
        items['range-start'].value = String(Number(items['range-end'].value) + 4);
        items['range-start'].handlers.get('input')();
        assert.equal(Number(items['range-start'].value), Number(items['range-end'].value) - 1);
        items['copy-report-image'].handlers.get('click')();
        await new Promise(setImmediate);
        assert.equal(copied.length, 1);
        assert.equal((await copied[0].contents['image/png']).type, 'image/png');
        assert.match(items['share-status'].textContent, /Image copied/);
        assert.deepEqual(calls.map(({ url }) => url), [`/api/contributions/${id}`, `/og/${id}.png`]);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        globalThis.ResizeObserver = originalResizeObserver;
        globalThis.WheelEvent = originalWheelEvent;
        if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
        else delete globalThis.navigator;
        globalThis.ClipboardItem = originalClipboardItem;
        await server.close();
    }
});
