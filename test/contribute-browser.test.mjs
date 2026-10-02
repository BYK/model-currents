import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { createServer } from 'vite';

const id = '0199abcf-22aa-7333-8abc-0123456789ab';
const token = 's'.repeat(43);
const events = [{ time: Date.UTC(2026, 8, 28), model: 'openai/gpt-5', kind: 'session' }];

function harness() {
    const names = ['contribution-preview', 'stored-counts', 'contribution-status', 'confirm-contribution',
        'close-contribution', 'contribution-result', 'contribution-link', 'contribution-public',
        'download-owner-key', 'share-contribution', 'unshare-contribution',
        'aggregate-contribution', 'withdraw-contribution', 'rotate-owner-key',
        'delete-contribution', 'owner-key-file'];
    const element = () => ({
        hidden: false, disabled: false, textContent: '', href: '', files: null, value: '', handlers: new Map(),
        addEventListener(type, listener) { this.handlers.set(type, listener); },
        dispatch(type) { return this.handlers.get(type)?.({ preventDefault() {} }); },
        removeAttribute(name) { if (name === 'href') this.href = ''; },
    });
    const items = Object.fromEntries(names.map((name) => [name, element()]));
    const button = element();
    const manage = element();
    const dialog = element();
    dialog.querySelector = (selector) => items[selector.slice(1)];
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    return { items, button, manage, dialog };
}

async function loadBrowser() {
    const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    try {
        const { setupContributions } = await server.ssrLoadModule('/src/contribute-browser.ts');
        return { setupContributions, close: () => server.close() };
    } catch (error) { await server.close(); throw error; }
}

test('browser creates a shareable personal chart outside the aggregate', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const calls = [];
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url, options) => {
            if (url instanceof URL && url.protocol === 'file:' && url.pathname.endsWith('/brotli_wasm_bg.wasm')) {
                return new Response(readFileSync(url), { headers: { 'Content-Type': 'application/wasm' } });
            }
            if (options?.method === undefined) return Response.json({ id, published: true, inAggregate: false, revision: 0,
                counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
            calls.push({ url, options });
            return Response.json({ id, token, published: true, inAggregate: false,
                url: `https://modeltides.dev/u/${id}` }, { status: 201 });
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => events, async () => {});
        ui.button.dispatch('click');
        await ui.items['confirm-contribution'].dispatch('click');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/contributions/personal');
        assert.equal(calls[0].options.method, 'POST');
        const body = JSON.parse(brotliDecompressSync(Buffer.from(await calls[0].options.body.arrayBuffer())));
        assert.deepEqual(body.weeks, [{ week: '2026-09-28', models: { 'openai/gpt-5': 1 } }]);
        assert.equal(ui.items['contribution-public'].hidden, false);
        ui.dialog.close();
        ui.manage.dispatch('click');
        await new Promise(setImmediate);
        await ui.items['confirm-contribution'].dispatch('click');
        assert.equal(calls[1].url, `/api/contributions/${id}`);
        assert.equal(calls[1].options.method, 'PUT');
        assert.equal(calls[1].options.headers['X-Model-Tides-Expected-Visibility'], 'public');
        assert.equal(calls[1].options.headers['X-Model-Tides-Expected-Aggregate'], 'excluded');
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('browser aggregate consent reviews stored counts and withdrawal preserves the personal link', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const state = { included: false, revision: 0, calls: [] };
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url, options) => {
            if (url === `/api/contributions/${id}`) return Response.json({ id, published: true,
                inAggregate: state.included, revision: state.revision,
                counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 3 }] });
            state.calls.push({ url, options });
            if (url === `/api/contributions/${id}/contribute` || url === `/api/contributions/${id}/withdraw`) {
                state.included = url.endsWith('/contribute');
                state.revision++;
                return Response.json({ id, inAggregate: state.included });
            }
            throw new Error('Unexpected request');
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => [], async () => {});
        ui.manage.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        assert.match(ui.items['stored-counts'].textContent, /openai\/gpt-5: 3/);
        assert.equal(ui.items['aggregate-contribution'].hidden, false);
        await ui.items['aggregate-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(state.calls[0].options.headers['X-Model-Tides-Reviewed-Revision'], '0');
        assert.equal(state.calls[0].options.body, undefined);
        assert.equal(ui.items['withdraw-contribution'].hidden, false);
        await ui.items['withdraw-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(state.included, false);
        assert.equal(ui.items['contribution-public'].hidden, false);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('browser warns before public replacement and reconciles a lost sharing response', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const current = { published: true, failRead: false };
        const uploads = [];
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url, options) => {
            if (url === `/api/contributions/${id}`) {
                if (options?.method === 'PUT') {
                    uploads.push(options);
                    throw new Error('Visibility must be confirmed before replacement');
                }
                if (current.failRead) throw new Error('Unavailable');
                return Response.json({ id, published: current.published, inAggregate: true, revision: 0,
                    counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
            }
            if (url === `/api/contributions/${id}/unshare`) {
                current.published = false;
                current.failRead = true;
                throw new Error('Response lost');
            }
            throw new Error('Unexpected request');
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => events, async () => {});
        ui.button.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        assert.match(ui.items['contribution-status'].textContent, /public.*reviewed counts.*appear/i);
        assert.equal(ui.items['confirm-contribution'].hidden, false);
        ui.items['unshare-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.match(ui.items['contribution-status'].textContent, /could not confirm.*visibility/i);
        assert.equal(ui.items['share-contribution'].hidden, true);
        assert.equal(ui.items['unshare-contribution'].hidden, true);
        assert.equal(ui.items['confirm-contribution'].disabled, true);
        await ui.items['confirm-contribution'].dispatch('click');
        assert.equal(uploads.length, 0, 'unknown visibility must block replacement even for programmatic clicks');
        current.failRead = false;
        ui.dialog.close();
        ui.manage.dispatch('click');
        await new Promise(setImmediate);
        assert.equal(ui.items['contribution-public'].hidden, true);
        assert.equal(ui.items['share-contribution'].hidden, false);
        assert.equal(ui.items['unshare-contribution'].hidden, true);
        assert.equal(ui.items['confirm-contribution'].disabled, false);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('browser verifies a committed share after the response is lost', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const current = { published: false, revision: 0 };
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url) => {
            if (url === `/api/contributions/${id}`) return Response.json({ id, published: current.published, revision: current.revision,
                counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
            if (url === `/api/contributions/${id}/share`) {
                current.published = true;
                current.revision++;
                throw new Error('Response lost');
            }
            throw new Error('Unexpected request');
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => [], async () => {});
        ui.manage.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        assert.equal(ui.items['share-contribution'].hidden, false);
        ui.items['share-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(ui.items['contribution-public'].hidden, false);
        assert.equal(ui.items['share-contribution'].hidden, true);
        assert.equal(ui.items['unshare-contribution'].hidden, false);
        assert.match(ui.items['contribution-status'].textContent, /public/i);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('browser shows every stored count before sharing and rechecks after a concurrent replacement', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const current = { published: false, revision: 2, shareCalls: 0 };
        const confirmations = [];
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: (question) => {
            confirmations.push(question);
            assert.match(ui.items['stored-counts'].textContent, /2026-09-21[\s\S]*older\/model: 7/);
            assert.match(ui.items['stored-counts'].textContent, new RegExp(`2026-09-28[\\s\\S]*newer/model: ${current.revision - 1}`));
            return true;
        } };
        globalThis.fetch = async (url, options) => {
            if (url === `/api/contributions/${id}`) return Response.json({ id, published: current.published,
                revision: current.revision, counts: [
                    { week: '2026-09-21', model: 'older/model', count: 7 },
                    { week: '2026-09-28', model: 'newer/model', count: current.revision - 1 },
                ] });
            if (url === `/api/contributions/${id}/share`) {
                current.shareCalls++;
                assert.equal(options.headers['X-Model-Tides-Reviewed-Revision'], String(current.revision));
                if (current.shareCalls === 1) { current.revision++; return Response.json({ error: 'Changed' }, { status: 409 }); }
                current.published = true;
                return Response.json({ id, published: true, url: `https://modeltides.dev/u/${id}` });
            }
            throw new Error('Unexpected request');
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => [], async () => {});
        ui.manage.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        assert.equal(ui.items['share-contribution'].hidden, false);
        ui.items['share-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(current.published, false);
        assert.match(ui.items['stored-counts'].textContent, /newer\/model: 2/);
        assert.match(ui.items['contribution-status'].textContent, /review.*again/i);
        ui.items['share-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(current.published, true);
        assert.equal(confirmations.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('reopening the browser manager rechecks report visibility even after a successful prior read', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const current = { published: false, reads: 0 };
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url) => {
            assert.equal(url, `/api/contributions/${id}`);
            current.reads++;
            return Response.json({ id, published: current.published, inAggregate: true, revision: 0,
                counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => events, async () => {});
        ui.manage.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        assert.equal(ui.items['share-contribution'].hidden, false);
        ui.dialog.close();
        current.published = true;
        ui.manage.dispatch('click');
        assert.equal(ui.items['confirm-contribution'].disabled, true);
        await new Promise(setImmediate);
        assert.equal(current.reads, 2);
        assert.equal(ui.items['share-contribution'].hidden, true);
        assert.equal(ui.items['unshare-contribution'].hidden, false);
        assert.match(ui.items['contribution-status'].textContent, /already public/i);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('a delayed owner read cannot restore a public link after hiding the report', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const pending = {};
        const state = { reads: 0, published: true };
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url, options) => {
            if (url === `/api/contributions/${id}` && options?.method === 'PUT') {
                return Response.json({ id, published: true, inAggregate: true, replacedWeeks: 1 });
            }
            if (url === `/api/contributions/${id}`) {
                state.reads++;
                if (state.reads === 2) return new Promise((resolve) => { pending.resolve = resolve; });
                return Response.json({ id, published: state.published, inAggregate: true, revision: 0,
                    counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
            }
            if (url === `/api/contributions/${id}/unshare`) {
                state.published = false;
                return Response.json({ id, published: false });
            }
            if (url instanceof URL && url.protocol === 'file:' && url.pathname.endsWith('/brotli_wasm_bg.wasm')) {
                return new Response(readFileSync(url), { headers: { 'Content-Type': 'application/wasm' } });
            }
            throw new Error('Unexpected request');
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => events, async () => {});
        ui.button.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        await ui.items['confirm-contribution'].dispatch('click');
        assert.equal(typeof pending.resolve, 'function');
        await ui.items['unshare-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(ui.items['contribution-public'].hidden, true);
        pending.resolve(Response.json({ id, published: true, revision: 0,
            counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] }));
        await new Promise(setImmediate);
        assert.equal(ui.items['contribution-public'].hidden, true);
        assert.equal(ui.items['unshare-contribution'].hidden, true);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});

test('browser can hide a migrated public report too large to review in one response', async () => {
    const browser = await loadBrowser();
    const originalFetch = globalThis.fetch;
    const originalLocation = globalThis.location;
    const originalWindow = globalThis.window;
    try {
        const ui = harness();
        const state = { published: true };
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url, options) => {
            if (url === `/api/contributions/${id}`) return Response.json({ id, published: state.published,
                revision: 0, tooLarge: true });
            if (url === `/api/contributions/${id}/unshare` && options.method === 'POST') {
                state.published = false;
                return Response.json({ id, published: false });
            }
            throw new Error('Unexpected request');
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => [], async () => {});
        ui.manage.dispatch('click');
        const key = JSON.stringify({ id, token });
        ui.items['owner-key-file'].files = [{ size: key.length, text: async () => key }];
        await ui.items['owner-key-file'].dispatch('change');
        assert.equal(ui.items['contribution-public'].hidden, false);
        assert.equal(ui.items['share-contribution'].hidden, true);
        assert.match(ui.items['contribution-status'].textContent, /too large|too many/i);
        await ui.items['unshare-contribution'].dispatch('click');
        await new Promise(setImmediate);
        assert.equal(ui.items['contribution-public'].hidden, true);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.location = originalLocation;
        globalThis.window = originalWindow;
        await browser.close();
    }
});
