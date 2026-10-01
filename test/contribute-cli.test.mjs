import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { collectSources, publishSnapshot, snapshotFromDocuments } from '../scripts/contribute.mjs';

const doc = {
    format: 'model-tides', version: 1, source: 'opencode',
    events: [
        { time: Date.UTC(2026, 8, 28), model: 'anthropic/claude-sonnet', kind: 'session' },
        { time: Date.UTC(2026, 8, 29), model: 'openai/gpt-5', kind: 'switch', fromModel: 'anthropic/claude-sonnet', fromTime: Date.UTC(2026, 8, 28) },
    ],
};

test('discovers supported local histories without following symlinks', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-cli-'));
    try {
        mkdirSync(join(home, '.local/share/opencode'), { recursive: true });
        mkdirSync(join(home, '.codex'));
        mkdirSync(join(home, '.claude'));
        writeFileSync(join(home, '.local/share/opencode/opencode.db'), 'fixture');
        symlinkSync(join(home, '.codex'), join(home, '.claude/projects'));
        assert.deepEqual(collectSources(home).map(({ name }) => name), ['OpenCode', 'Codex']);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('CLI sends only approved weekly model counts as Brotli, with private token only on replacement', async () => {
    const snapshot = snapshotFromDocuments([doc]);
    const calls = [];
    const fakeFetch = async (url, options) => {
        const body = JSON.parse(brotliDecompressSync(options.body).toString('utf8'));
        calls.push({ url, method: options.method, headers: options.headers, body });
        return new Response(JSON.stringify({ id: 'public-id', token: 'private-token' }), { status: 201 });
    };
    await publishSnapshot(snapshot, null, fakeFetch, 'https://example.test/api/contributions');
    await publishSnapshot(snapshot, { id: 'public-id', token: 'private-token' }, fakeFetch, 'https://example.test/api/contributions');
    assert.equal(calls[0].url, 'https://example.test/api/contributions');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['Content-Encoding'], 'br');
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(calls[1].url, 'https://example.test/api/contributions/public-id');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].headers.Authorization, 'Bearer private-token');
    assert.deepEqual(calls[0].body, { format: 'model-tides-weekly', version: 1, weeks: [{
        week: '2026-09-28', models: { 'anthropic/claude-sonnet': 1, 'openai/gpt-5': 1 },
    }] });
    for (const key of ['events', 'time', 'kind', 'fromModel', 'fromTime', 'source', 'sessionId']) {
        assert.equal(JSON.stringify(calls[0].body).includes(`"${key}"`), false);
    }
});

test('CLI rejects a metadata document carrying a private field before any upload', () => {
    assert.throws(() => snapshotFromDocuments([{ ...doc, sessionId: 'secret' }]), TypeError);
    assert.throws(() => snapshotFromDocuments([{ ...doc, source: 'example' }]), /Invented example/);
});
