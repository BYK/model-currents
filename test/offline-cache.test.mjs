import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import config from '../vite.config.ts';

test('activating Model Tides preserves caches owned by other service worker scopes', async () => {
    const plugin = config.plugins[0];
    const emitted = { worker: undefined };
    plugin.generateBundle.call({ emitFile(asset) { emitted.worker = asset.source; } }, {}, {});
    const worker = emitted.worker;
    assert.equal(typeof worker, 'string');
    const current = worker.match(/const CACHE = '([^']+)'/)?.[1];
    assert.ok(current);

    const listeners = new Map();
    const deleted = [];
    const caches = {
        keys: async () => ['model-currents-old', 'model-tides-old', current, 'another-site'],
        delete: async (key) => { deleted.push(key); return true; },
    };
    const self = {
        registration: { scope: 'https://example.test/model-tides/' },
        clients: { claim: async () => {} },
        addEventListener: (type, listener) => listeners.set(type, listener),
    };
    runInNewContext(worker, { self, caches, Promise, URL });
    const activation = { promise: undefined };
    listeners.get('activate')({ waitUntil: (promise) => { activation.promise = promise; } });
    await activation.promise;
    assert.deepEqual(deleted, ['model-tides-old']);
});

test('offline navigation caches the app, but lets share and API pages reach the Worker', async () => {
    const plugin = config.plugins[0];
    const emitted = { worker: undefined };
    plugin.generateBundle.call({ emitFile(asset) { emitted.worker = asset.source; } }, {}, {});

    const listeners = new Map();
    const cached = { source: 'offline app', redirected: false };
    const redirected = { source: 'redirect', redirected: true };
    const network = { source: 'Worker' };
    const self = {
        location: { origin: 'https://modeltides.dev' },
        registration: { scope: 'https://modeltides.dev/' },
        addEventListener: (type, listener) => listeners.set(type, listener),
    };
    const caches = { match: async (request) => {
        const path = new URL(request.url ?? request).pathname;
        return path === '/' ? cached : path === '/index.html' ? redirected : undefined;
    } };
    const fetch = async () => network;
    runInNewContext(emitted.worker, { self, caches, fetch, Promise, URL });

    const navigate = async (path) => {
        const event = {
            request: { method: 'GET', mode: 'navigate', url: `https://modeltides.dev${path}` },
            respondWith(promise) { this.response = promise; },
        };
        listeners.get('fetch')(event);
        return event.response;
    };

    assert.equal(await navigate('/'), cached);
    assert.equal((await navigate('/')).redirected, false, 'redirected HTML cannot answer a navigation');
    assert.equal(await navigate('/local/'), cached, 'the private timeline stays available offline');
    assert.equal(await navigate('/gist'), cached, 'the gist viewer shell stays available offline without caching gist contents');
    assert.equal(await navigate('/u/example'), network);
    assert.equal(await navigate('/api/aggregate'), network);
    const external = { request: { method: 'GET', mode: 'cors', url: 'https://api.github.com/gists/00000000000000000000000000000000' },
        respondWith() { throw new Error('GitHub requests must not be intercepted by the site cache'); } };
    listeners.get('fetch')(external);
});
