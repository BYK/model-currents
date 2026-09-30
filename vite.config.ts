import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

function offlineAssets(): Plugin {
    return {
        name: 'model-currents-offline-assets',
        apply: 'build',
        generateBundle(_options, bundle) {
            const files = ['index.html', ...Object.keys(bundle)].sort();
            const indexSource = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)));
            const version = createHash('sha256').update(files.join('\n')).update(indexSource).digest('hex').slice(0, 12);
            this.emitFile({
                type: 'asset',
                fileName: 'sw.js',
                source: `const CACHE = 'model-currents-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new URL(file, self.registration.scope)))));
    self.skipWaiting();
});
self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all([
        caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('model-currents-') && key !== CACHE).map((key) => caches.delete(key)))),
        self.clients.claim(),
    ]));
});
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
    const response = event.request.mode === 'navigate'
        ? caches.match(new URL('index.html', self.registration.scope))
        : caches.match(event.request);
    event.respondWith(response.then((cached) => cached || fetch(event.request)));
});`,
            });
        },
    };
}

export default defineConfig({ base: './', plugins: [offlineAssets()] });
