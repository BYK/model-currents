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
