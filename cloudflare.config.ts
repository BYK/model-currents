import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ isPreview, mode }) => ({
    worker: {
        name: 'model-tides',
        compatibilityDate: '2026-10-01',
        entrypoint: './worker/index.ts',
        domains: isPreview || mode === 'staging' ? [] : ['modeltides.dev', 'www.modeltides.dev'],
        assets: {
            notFoundHandling: 'none',
            runWorkerFirst: true,
        },
        env: { ASSETS: bindings.assets() },
    },
}));
