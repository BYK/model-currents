import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { loadGistSnapshot, gistAddress } from '../src/gist-view.ts';

const id = '1feed6ae2071f64565d1f1e092fdde32';
const snapshot = { format: 'model-tides-weekly', version: 1, weeks: [
    { week: '2026-09-28', models: { 'github-copilot/claude-opus-4.5': 2, 'openrouter/example:free': 1 } },
] };
const gist = (content = JSON.stringify(snapshot)) => ({
    id, owner: { login: 'BYK' }, files: { 'model-tides-weekly.json': {
        filename: 'model-tides-weekly.json', truncated: false, content,
    } },
});

test('a gist URL loads weekly counts directly from GitHub, never through Model Tides', async () => {
    const calls = [];
    const result = await loadGistSnapshot('BYK', id, async (url, options) => {
        calls.push({ url, options });
        return Response.json(gist());
    });
    assert.deepEqual(result, { snapshot, owner: 'BYK' });
    assert.equal(gistAddress('BYK', id), `https://modeltides.dev/gist#BYK/${id}`);
    assert.deepEqual(calls.map(({ url }) => url), [`https://api.github.com/gists/${id}`]);
    assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
    assert.equal(calls[0].options.cache, 'no-store');
});

test('invalid paths, ownership, extra files, private fields, and large gists fail closed', async () => {
    const called = [];
    const fetchGist = (data) => async (url) => {
        called.push(url);
        return Response.json(data);
    };
    await assert.rejects(loadGistSnapshot('../BYK', id, fetchGist(gist())), /Invalid gist address/);
    await assert.rejects(loadGistSnapshot('BYK', `${id}?private`, fetchGist(gist())), /Invalid gist address/);
    assert.equal(called.length, 0);
    for (const invalid of [
        { ...gist(), id: '2'.repeat(32) },
        { ...gist(), owner: null },
        { ...gist(), files: { ...gist().files, 'private.json': { content: 'private transcript' } } },
        gist(JSON.stringify({ ...snapshot, events: [{ prompt: 'private transcript' }] })),
        gist(JSON.stringify({ ...snapshot, weeks: [{ week: '2026-09-28', models: { example: 10_001 } }] })),
        gist('x'.repeat(520_000)),
    ]) {
        await assert.rejects(loadGistSnapshot('BYK', id, fetchGist(invalid)), /Could not load a valid weekly-count gist/);
    }
});

test('a GitHub username change does not break an ID-based gist link', async () => {
    const renamed = { ...gist(), owner: { login: 'NewOwner' } };
    assert.deepEqual(await loadGistSnapshot('BYK', id, async () => Response.json(renamed)),
        { snapshot, owner: 'NewOwner' });
});

test('a failed GitHub fetch does not leak its response body or error text', async () => {
    await assert.rejects(loadGistSnapshot('BYK', id, async () =>
        new Response('private transcript', { status: 403 })), (error) =>
        error.message === 'Could not load a valid weekly-count gist.');
    await assert.rejects(loadGistSnapshot('BYK', id, async () => {
        throw new Error('private transcript');
    }), (error) => error.message === 'Could not load a valid weekly-count gist.');
});

test('complete gist and mock counts show inferred shifts, but filtered community counts do not', async () => {
    const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    try {
        const { renderWeeklyRows } = await server.ssrLoadModule('/src/global-view.ts');
        const rows = [
            { week: '2026-09-07', model: 'old', count: 6 },
            { week: '2026-09-14', model: 'new', count: 5 },
        ];
        const chart = { innerHTML: '', setAttribute() {} };
        renderWeeklyRows(chart, rows, 'shared');
        assert.doesNotMatch(chart.innerHTML, /flow-inferred/);
        renderWeeklyRows(chart, rows, 'gist');
        assert.match(chart.innerHTML, /class="flow-ribbon flow-inferred"/);
        renderWeeklyRows(chart, rows, 'mock');
        assert.match(chart.innerHTML, /class="flow-ribbon flow-inferred"/);
    } finally {
        await server.close();
    }
});

test('the browser renders a gist without sending its contents to Model Tides or injecting model labels', async () => {
    const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    try {
        const element = () => ({ hidden: false, textContent: '', innerHTML: '', children: [], handlers: new Map(),
            append(child) { this.children.push(child); },
            replaceChildren(...children) { this.children = children; },
            setAttribute() {},
            addEventListener(type, handler) { this.handlers.set(type, handler); },
        });
        const items = Object.fromEntries(['app', 'theme-toggle', 'gist-status', 'gist-chart', 'gist-source',
            'gist-donate', 'gist-donate-consent', 'gist-donate-submit', 'gist-donate-status',
            'gist-donate-result', 'gist-donate-counts', 'gist-personal-link', 'gist-key-download',
            'gist-legacy-note'].map((name) => [name, element()]));
        items.app.querySelector = (selector) => items[selector.slice(1)];
        globalThis.document = {
            documentElement: { dataset: {} },
            querySelector: (selector) => selector === '#app' ? items.app : { content: '' },
            createDocumentFragment: element,
            createElement: element,
        };
        const history = [];
        const handlers = new Map();
        globalThis.window = {
            location: { pathname: '/gist', hash: `#BYK/${id}` },
            matchMedia: () => ({ matches: false, addEventListener() {} }),
            addEventListener(type, handler) { handlers.set(type, handler); },
            history: { replaceState(_state, _title, url) { history.push(url); } },
        };
        const calls = [];
        const fixture = { version: 1 };
        globalThis.fetch = async (url) => {
            calls.push(url);
            return Response.json({ ...gist(JSON.stringify({ ...snapshot, version: fixture.version, weeks: [
                { week: '2026-09-28', models: { '<img src=x onerror=alert(1)>': 1 } },
            ] })), owner: { login: 'NewOwner' } });
        };
        await server.ssrLoadModule('/src/gist-page.ts');
        await new Promise(setImmediate);
        assert.deepEqual(calls, [`https://api.github.com/gists/${id}`]);
        assert.doesNotMatch(items.app.innerHTML, /View exact weekly counts|<table/);
        assert.doesNotMatch(items.app.innerHTML + items['gist-chart'].innerHTML, /<img src=x/);
        assert.match(items['gist-chart'].innerHTML, /&lt;img src=x/);
        assert.match(items['gist-status'].textContent, /1 self-reported earlier model-use events/);
        assert.match(items['gist-status'].textContent, /across 1 week ·/);
        assert.equal(items['gist-donate'].hidden, true, 'v1 counts cannot be rebranded as active session-days');
        assert.equal(items['gist-legacy-note'].hidden, false);
        assert.match(items['gist-status'].textContent, /NewOwner/);
        assert.deepEqual(history, [`/gist#NewOwner/${id}`]);
        assert.equal(items['gist-source'].href, `https://gist.github.com/NewOwner/${id}`);
        fixture.version = 2;
        globalThis.window.location.hash = `#NewOwner/${id}`;
        handlers.get('hashchange')();
        await new Promise(setImmediate);
        assert.equal(items['gist-donate'].hidden, false);
        assert.equal(items['gist-donate-submit'].disabled, true);
        assert.equal(items['gist-donate-counts'].textContent.includes('<img src=x onerror=alert(1)>'), true);
        assert.equal(items['gist-donate-counts'].innerHTML, '', 'model names are never interpolated as HTML');
        items['gist-donate-submit'].handlers.get('click')();
        assert.deepEqual(calls, [`https://api.github.com/gists/${id}`, `https://api.github.com/gists/${id}`],
            'a viewer without consent sends nothing to Model Tides');
        items['gist-donate-consent'].checked = true;
        items['gist-donate-consent'].handlers.get('change')();
        assert.equal(items['gist-donate-submit'].disabled, false);
        globalThis.window.location.hash = '#invalid';
        handlers.get('hashchange')();
        assert.equal(items['gist-status'].textContent, 'Invalid gist address.');
        assert.equal(items['gist-source'].hidden, true);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        await server.close();
    }
});
