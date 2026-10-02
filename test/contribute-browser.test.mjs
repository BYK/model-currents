import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { createServer } from 'vite';

const id = '0199abcf-22aa-7333-8abc-0123456789ab';
const token = 's'.repeat(43);
const events = [{ time: Date.UTC(2026, 8, 28), model: 'openai/gpt-5', kind: 'session' }];

function harness() {
    const names = ['contribution-preview', 'contribution-status', 'confirm-contribution',
        'close-contribution', 'contribution-result', 'contribution-link', 'contribution-public',
        'download-owner-key', 'share-contribution', 'unshare-contribution', 'rotate-owner-key',
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

test('browser creates a private contribution at the versioned path', async () => {
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
            calls.push({ url, options });
            return Response.json({ id, token, published: false }, { status: 201 });
        };
        browser.setupContributions(ui.button, ui.manage, ui.dialog, () => events, async () => {});
        ui.button.dispatch('click');
        await ui.items['confirm-contribution'].dispatch('click');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/contributions/private');
        assert.equal(calls[0].options.method, 'POST');
        const body = JSON.parse(brotliDecompressSync(Buffer.from(await calls[0].options.body.arrayBuffer())));
        assert.deepEqual(body.weeks, [{ week: '2026-09-28', models: { 'openai/gpt-5': 1 } }]);
        assert.equal(ui.items['contribution-public'].hidden, true);
        ui.dialog.close();
        ui.manage.dispatch('click');
        await ui.items['confirm-contribution'].dispatch('click');
        assert.equal(calls[1].url, `/api/contributions/${id}`);
        assert.equal(calls[1].options.method, 'PUT');
        assert.equal(calls[1].options.headers['X-Model-Tides-Expected-Visibility'], 'private');
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
                return Response.json({ id, published: current.published, counts: [] });
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
        const current = { published: false };
        globalThis.location = { origin: 'https://modeltides.dev' };
        globalThis.window = { confirm: () => true };
        globalThis.fetch = async (url) => {
            if (url === `/api/contributions/${id}`) return Response.json({ id, published: current.published, counts: [] });
            if (url === `/api/contributions/${id}/share`) {
                current.published = true;
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
