import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ isPreview, mode }) => ({
    worker: {
        name: mode === 'staging' ? 'model-tides-staging' : 'model-tides',
        compatibilityDate: '2026-10-01',
        entrypoint: './worker/index.ts',
        domains: isPreview || mode === 'staging' ? [] : ['modeltides.dev', 'www.modeltides.dev'],
        assets: {
            notFoundHandling: 'none',
            runWorkerFirst: true,
        },
        env: {
            ASSETS: bindings.assets(),
            DB: bindings.d1({
                id: isPreview || mode === 'staging'
                    ? '7c5cda20-3b63-4dd2-ae99-a46c8583a884'
                    : '2d81d7c6-d712-4385-813a-c00ce9f17600',
                name: isPreview || mode === 'staging' ? 'model-tides-preview' : 'model-tides-contributions',
            }),
            UPLOAD_LIMIT: bindings.rateLimit({ namespace: '439201', simple: { limit: 10, period: 60 } }),
        },
    },
}));
