import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModelRegistry } from '../worker/models-registry.ts';

test('models.dev provider IDs and canonical IDs are checked without sending user models upstream', async () => {
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push({ url, method: options?.method, body: options?.body });
        return Response.json(url.endsWith('/models.json') ? {
            'openai/gpt-5-codex': { id: 'openai/gpt-5-codex' },
        } : {
            openrouter: { models: { 'anthropic/claude-sonnet-4': { id: 'anthropic/claude-sonnet-4' } } },
            'amazon-bedrock': { models: { 'us.anthropic.claude-opus-4-20250514-v1:0': {
                id: 'us.anthropic.claude-opus-4-20250514-v1:0',
                canonical_model_id: 'anthropic/claude-opus-4-20250514',
            } } },
        });
    };
    const models = await createModelRegistry(fetcher)();
    for (const id of ['openai/gpt-5-codex', 'openrouter/anthropic/claude-sonnet-4',
        'anthropic/claude-sonnet-4', 'amazon-bedrock/us.anthropic.claude-opus-4-20250514-v1:0',
        'anthropic/claude-opus-4-20250514']) assert.equal(models.has(id), true, id);
    assert.equal(models.has('anthropic/invented-model'), false);
    assert.deepEqual(calls.map(({ url }) => url).sort(), [
        'https://models.dev/api.json', 'https://models.dev/models.json',
    ]);
    assert.equal(calls.some(({ method, body }) => method || body), false);
});

test('invalid registry responses fail closed and do not cache unknown IDs', async () => {
    const requests = { value: 0 };
    const models = createModelRegistry(async (url) => {
        requests.value++;
        return Response.json(url.endsWith('/api.json')
            ? { openai: { models: { 'gpt-5': {} } } } : { 'custom/fake-model': {} });
    });
    await assert.rejects(models(), /models.dev/);
    await assert.rejects(models(), /models.dev/);
    assert.equal(requests.value, 4, 'invalid catalog responses must not be cached');
});

test('concurrent checks use one catalog fetch per endpoint and reuse a valid cache', async () => {
    const requests = { value: 0 };
    const models = createModelRegistry(async (url) => {
        requests.value++;
        return Response.json(url.endsWith('/api.json')
            ? { openai: { models: { 'gpt-5': { id: 'gpt-5' } } } }
            : { 'openai/gpt-5': { id: 'openai/gpt-5' } });
    });
    const [first, second] = await Promise.all([models(), models()]);
    assert.equal(first, second);
    assert.equal(await models(), first);
    assert.equal(requests.value, 2);
});
