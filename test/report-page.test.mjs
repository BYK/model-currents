import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('a shared report renders an explorable flow chart from public weekly counts, never raw history', async () => {
    const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    try {
        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        const element = () => ({ hidden: false, textContent: '', innerHTML: '', value: '', children: [], handlers: new Map(),
            append(child) { this.children.push(child); },
            replaceChildren(...children) { this.children = children; },
            setAttribute() {},
            addEventListener(type, handler) { this.handlers.set(type, handler); },
        });
        const items = Object.fromEntries(['app', 'theme-toggle', 'report-status', 'report-chart', 'report-controls',
            'report-from', 'report-to', 'report-models', 'report-details', 'report-table'].map((name) => [name, element()]));
        items.app.querySelector = (selector) => items[selector.slice(1)];
        globalThis.document = {
            documentElement: { dataset: {} },
            querySelector: (selector) => selector === '#app' ? items.app : { content: '' },
            createDocumentFragment: element,
            createElement: element,
        };
        globalThis.window = {
            location: { pathname: `/u/${id}` }, matchMedia: () => ({ matches: false, addEventListener() {} }),
        };
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            return Response.json({ id, published: true, counts: [
                { week: '2026-09-21', model: '<img src=x onerror=alert(1)>', count: 2 },
                { week: '2026-09-28', model: 'openai/gpt-5', count: 1 },
            ] });
        };
        await server.ssrLoadModule('/src/report-page.ts');
        await new Promise(setImmediate);
        assert.deepEqual(calls.map(({ url }) => url), [`/api/contributions/${id}`]);
        assert.equal(calls[0].options.cache, 'no-store');
        assert.match(items['report-chart'].innerHTML, /<svg/);
        assert.doesNotMatch(items['report-chart'].innerHTML, /<img src=x/);
        assert.match(items['report-chart'].innerHTML, /&lt;img src=x/);
        assert.match(items['report-status'].textContent, /3 model uses/);
        assert.equal(items['report-details'].hidden, false);
        items['report-from'].value = '1';
        items['report-from'].handlers.get('input')();
        assert.match(items['report-status'].textContent, /1 model uses.*2026-09-28 to 2026-09-28/);
        items['report-models'].handlers.get('click')();
        assert.equal(items['report-models'].textContent, 'Group smaller models');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        await server.close();
    }
});
