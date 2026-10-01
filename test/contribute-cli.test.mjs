import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { collectSources, exportLocal, publishSnapshot, snapshotFromDocuments } from '../scripts/contribute.mjs';
import { parseUsageDocument } from '../src/usage-data.ts';

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
        assert.deepEqual(collectSources(home).map(({ name }) => name), ['OpenCode']);
        writeFileSync(join(home, '.codex/unrelated.jsonl'), 'not a rollout');
        assert.deepEqual(collectSources(home).map(({ name }) => name), ['OpenCode']);
        mkdirSync(join(home, '.codex/sessions'));
        writeFileSync(join(home, '.codex/sessions/rollout-test.jsonl'), '{}\n');
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
    assert.throws(() => snapshotFromDocuments([{ ...doc, source: 'example' }]), /Mock data/);
});

test('malformed input never prints private JSON text', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-invalid-input-'));
    try {
        const path = join(home, 'bad.json');
        writeFileSync(path, '{"private transcript":"do not print this",');
        const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/contribute.mjs', 'upload', '--input', path], {
            cwd: new URL('../', import.meta.url), encoding: 'utf8',
            env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home },
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Expected a Model Tides v1 metadata file/);
        assert.doesNotMatch(result.stderr, /private transcript|do not print this/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('malformed local owner key never prints credential text', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-invalid-key-'));
    try {
        mkdirSync(join(home, 'model-tides'));
        writeFileSync(join(home, 'model-tides/contribution.json'), '{"token":"private-key-material",', { mode: 0o600 });
        const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/contribute.mjs', 'upload', '--delete'], {
            cwd: new URL('../', import.meta.url), encoding: 'utf8',
            env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home },
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Invalid local private key file/);
        assert.doesNotMatch(result.stderr, /private-key-material/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('CLI export combines local metadata for browser import without contacting the site or overwriting a file', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-export-'));
    try {
        const codex = join(home, '.codex/sessions/2025/01/01');
        const claude = join(home, '.claude/projects/example');
        mkdirSync(codex, { recursive: true });
        mkdirSync(claude, { recursive: true });
        const at = (offset) => new Date(Date.UTC(2025, 0, 1) + offset).toISOString();
        writeFileSync(join(codex, 'rollout-test.jsonl'), [
            { timestamp: at(0), type: 'session_meta', payload: { id: 'private-session', timestamp: at(0), model_provider: 'openai', cwd: '/private/path' } },
            { timestamp: at(1000), type: 'turn_context', payload: { model: 'gpt-5', instructions: 'private prompt' } },
        ].map(JSON.stringify).join('\n') + '\n');
        writeFileSync(join(claude, 'session.jsonl'), JSON.stringify({
            timestamp: at(2000), type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: 'private reply' },
            sessionId: 'private-claude-id',
        }) + '\n');
        const path = join(home, 'history.json');
        const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'config'), HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' };
        const run = (output) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/contribute.mjs', 'export', '--output', output], {
            cwd: new URL('../', import.meta.url), env, encoding: 'utf8', timeout: 10_000,
        });
        const result = run(path);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Scanning Codex history/);
        assert.match(result.stdout, /Scanning Claude Code history/);
        const bytes = readFileSync(path, 'utf8');
        assert.deepEqual(parseUsageDocument(JSON.parse(bytes)), { format: 'model-tides', version: 1, source: 'multiple', events: [
            { time: Date.UTC(2025, 0, 1), model: 'openai/gpt-5', kind: 'session' },
            { time: Date.UTC(2025, 0, 1) + 2000, model: 'anthropic/claude-sonnet-4-5', kind: 'session' },
        ] });
        assert.doesNotMatch(bytes, /private|sessionId|message|content|cwd|instructions|path|prompt|reply/i);
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.match(result.stdout, /modeltides\.dev\/local\//);
        assert.match(result.stdout, /exact event timestamps/i);

        const repeated = run(path);
        assert.notEqual(repeated.status, 0);
        assert.equal(readFileSync(path, 'utf8'), bytes);

        const link = join(home, 'link.json');
        symlinkSync(path, link);
        assert.notEqual(run(link).status, 0);
        assert.equal(readFileSync(path, 'utf8'), bytes);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test('Codex scanning reports progress and a sanitized malformed-record reason', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-malformed-'));
    try {
        const file = join(home, 'rollout-bad.jsonl');
        writeFileSync(file, [
            JSON.stringify({ timestamp: '2025-01-01T00:00:00Z', type: 'session_meta', payload: { id: 'private-session' } }),
            '{"private transcript":',
        ].join('\n') + '\n');
        const progress = [];
        assert.throws(() => exportLocal([{ name: 'Codex', path: file, script: 'export-history.py', args: ['codex'] }],
            (message) => progress.push(message)), /Codex.*malformed.*record/i);
        assert.deepEqual(progress, ['Scanning Codex history…']);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('a detected history with no model observations is reported and skipped without losing other sources', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-no-models-'));
    try {
        const codex = join(home, 'rollout-empty.jsonl');
        const claude = join(home, 'session.jsonl');
        writeFileSync(codex, JSON.stringify({
            timestamp: '2025-01-01T00:00:00Z', type: 'session_meta', payload: { id: 'private-id' },
        }) + '\n');
        writeFileSync(claude, JSON.stringify({
            timestamp: '2025-01-01T00:00:01Z', type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-4-5', content: 'private reply' },
        }) + '\n');
        const progress = [];
        const result = exportLocal([
            { name: 'Codex', path: codex, script: 'export-history.py', args: ['codex'] },
            { name: 'Claude Code', path: claude, script: 'export-history.py', args: ['claude-code'] },
        ], (message) => progress.push(message));
        assert.deepEqual(result.weeks, [{ week: '2024-12-30', models: { 'anthropic/claude-sonnet-4-5': 1 } }]);
        assert.deepEqual(progress, [
            'Scanning Codex history…', 'Codex has no model observations; skipped.',
            'Scanning Claude Code history…', 'Claude Code scan complete.',
        ]);
    } finally { rmSync(home, { recursive: true, force: true }); }
});
