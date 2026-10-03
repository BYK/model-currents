import assert from 'node:assert/strict';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import test from 'node:test';
import { loadOwnedForDonation, donateOwnedReport, donateGistSnapshot } from '../src/donation.ts';

const id = '0199abcf-22aa-7333-8abc-0123456789ab';
const token = 's'.repeat(43);
const snapshot = { format: 'model-tides-weekly', version: 2, weeks: [
    { week: '2026-09-28', models: { 'openai/gpt-5': 3 } },
] };

test('a /u donation requires a private owner key and reviewed complete v2 report, with no counts in the write', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'GET') return Response.json({ id, published: true, inAggregate: false,
            metricVersion: 2, revision: 4, counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 3 }] });
        return Response.json({ id, inAggregate: true });
    };
    await assert.rejects(loadOwnedForDonation(id, 'bad-key', fetchImpl), /private owner key/i);
    assert.equal(calls.length, 0);
    const report = await loadOwnedForDonation(id, token, fetchImpl);
    assert.equal(report.revision, 4);
    assert.deepEqual(report.snapshot, snapshot);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal((await donateOwnedReport(id, token, report, fetchImpl)).inAggregate, true);
    assert.equal(calls[1].url, `/api/contributions/${id}/contribute`);
    assert.deepEqual(calls[1].options.headers, { Authorization: `Bearer ${token}`,
        'X-Model-Tides-Reviewed-Revision': '4' });
    assert.equal(calls[1].options.body, undefined);
    assert.equal(JSON.stringify(calls).includes('sessionId'), false);
});

test('a public /u link and a wrong key never authorize donation', async () => {
    const calls = [];
    const fetchImpl = async (_url, options) => {
        calls.push(options.method);
        return Response.json({ error: 'Invalid contribution or token.' }, { status: 401 });
    };
    await assert.rejects(loadOwnedForDonation(id, token, fetchImpl), /Could not verify the private owner key/i);
    assert.deepEqual(calls, ['GET']);
    await assert.rejects(donateOwnedReport(id, token, { revision: 0, snapshot: null }, fetchImpl), /review/i);
    assert.deepEqual(calls, ['GET']);
});

test('a gist donation sends only reviewed v2 weekly counts and returns a separate downloadable key', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        return Response.json({ id, token, published: true, inAggregate: true, metricVersion: 2,
            url: `https://modeltides.dev/u/${id}` }, { status: 201 });
    };
    await assert.rejects(donateGistSnapshot({ ...snapshot, version: 1 }, fetchImpl), /active session-day/i);
    assert.equal(calls.length, 0);
    const result = await donateGistSnapshot(snapshot, fetchImpl, async (bytes) => brotliCompressSync(bytes));
    assert.deepEqual(result, { id, token, url: `https://modeltides.dev/u/${id}` });
    assert.equal(calls[0].url, '/api/contributions/donate-v2');
    assert.equal(calls[0].options.headers['X-Model-Tides-Schema'], 'weekly-v2');
    assert.equal(calls[0].options.headers['X-Model-Tides-Report'], 'donated-v2');
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[0].options.redirect, 'error');
    assert.deepEqual(JSON.parse(brotliDecompressSync(calls[0].options.body).toString('utf8')), snapshot);
    assert.equal(JSON.stringify(calls[0].options.headers).includes('gist'), false);
});
