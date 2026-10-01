import { validWeeklyModel } from '../src/weekly-snapshot.ts';

const registryOrigin = 'https://models.dev/';
const MAX_API_BYTES = 8 * 1024 * 1024;
const MAX_MODELS_BYTES = 1024 * 1024;
const CACHE_MS = 60 * 60 * 1000;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function catalog(url: string, limit: number, fetcher: typeof fetch): Promise<Record<string, unknown>> {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('models.dev catalog unavailable.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    const size = { value: 0 };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size.value += value.byteLength;
        if (size.value > limit) {
            await reader.cancel();
            throw new Error('models.dev catalog exceeds the size limit.');
        }
        chunks.push(value);
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size.value)));
    if (!record(parsed) || Object.keys(parsed).length === 0) throw new Error('Invalid models.dev catalog.');
    return parsed;
}

export function createModelRegistry(fetcher: typeof fetch = fetch): () => Promise<ReadonlySet<string>> {
    const cache: { models: ReadonlySet<string> | null; expires: number; pending: Promise<ReadonlySet<string>> | null } = {
        models: null, expires: 0, pending: null,
    };
    return () => {
        if (cache.models && Date.now() < cache.expires) return Promise.resolve(cache.models);
        if (cache.pending) return cache.pending;
        cache.pending = (async () => {
            const [models, providers] = await Promise.all([
                catalog(`${registryOrigin}models.json`, MAX_MODELS_BYTES, fetcher),
                catalog(`${registryOrigin}api.json`, MAX_API_BYTES, fetcher),
            ]);
            const ids = new Set<string>();
            for (const [id, details] of Object.entries(models)) {
                if (!validWeeklyModel(id) || !record(details) || details.id !== id) {
                    throw new Error('Invalid models.dev model.');
                }
                ids.add(id);
            }
            for (const [provider, details] of Object.entries(providers)) {
                if (!record(details) || !record(details.models)) throw new Error('Invalid models.dev provider.');
                for (const [id, model] of Object.entries(details.models)) {
                    if (!record(model) || model.id !== id || !validWeeklyModel(`${provider}/${id}`)) {
                        throw new Error('Invalid models.dev provider model.');
                    }
                    ids.add(`${provider}/${id}`);
                    if (model.canonical_model_id !== undefined) {
                        if (!validWeeklyModel(model.canonical_model_id)) throw new Error('Invalid models.dev model ID.');
                        ids.add(model.canonical_model_id);
                    }
                    // OpenRouter IDs already include the originating lab. Keep both
                    // the observed route and its lab/model spelling if listed.
                    if (provider === 'openrouter' && id.includes('/') && validWeeklyModel(id)) ids.add(id);
                }
            }
            cache.models = ids;
            cache.expires = Date.now() + CACHE_MS;
            return ids;
        })().finally(() => { cache.pending = null; });
        return cache.pending;
    };
}

export const knownModels = createModelRegistry();
