import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.ts';

test('the Worker serves app assets and keeps future dynamic routes out of static hosting', async () => {
    const requests = [];
    const env = { ASSETS: { async fetch(request) {
        requests.push(request.url);
        return new Response('asset');
    } } };

    const home = await worker.fetch(new Request('https://modeltides.dev/'), env);
    assert.equal(await home.text(), 'asset');
    const image = await worker.fetch(new Request('https://modeltides.dev/assets/image.svg'), env);
    assert.equal(await image.text(), 'asset');
    const privateView = await worker.fetch(new Request('https://modeltides.dev/local/'), env);
    assert.equal(await privateView.text(), 'asset');
    const gistView = await worker.fetch(new Request('https://modeltides.dev/gist'), env);
    assert.equal(await gistView.text(), 'asset');

    for (const path of ['/api/future', '/api/models', '/u/public-id', '/og/public-id.png']) {
        const response = await worker.fetch(new Request(`https://modeltides.dev${path}`), env);
        assert.equal(response.status, 404);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    assert.deepEqual(requests, ['https://modeltides.dev/', 'https://modeltides.dev/assets/image.svg',
        'https://modeltides.dev/', 'https://modeltides.dev/'], 'gist routes serve only the app shell without a gist address');
    const missingBinding = await worker.fetch(new Request('https://modeltides.dev/api/aggregate'), env);
    assert.equal(missingBinding.status, 503);
});

test('the Worker redirects www and refuses writes to static paths', async () => {
    const env = { ASSETS: { async fetch() { throw new Error('Assets should not be fetched'); } } };
    const redirect = await worker.fetch(new Request('https://www.modeltides.dev/u/id?view=1'), env);
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('Location'), 'https://modeltides.dev/u/id?view=1');

    const insecure = await worker.fetch(new Request('http://modeltides.dev/u/id?view=1'), env);
    assert.equal(insecure.status, 308);
    assert.equal(insecure.headers.get('Location'), 'https://modeltides.dev/u/id?view=1');

    const write = await worker.fetch(new Request('https://modeltides.dev/', { method: 'POST' }), env);
    assert.equal(write.status, 405);
    assert.equal(write.headers.get('Allow'), 'GET, HEAD');
});
