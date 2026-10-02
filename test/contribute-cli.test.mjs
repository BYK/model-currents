import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { collectSources, exportLocal, publishSnapshot, reportVisibility, setSharing, snapshotFromDocuments } from '../scripts/contribute.mjs';
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
    await publishSnapshot(snapshot, { id: 'public-id', token: 'private-token' }, fakeFetch,
        'https://example.test/api/contributions', false);
    assert.equal(calls[0].url, 'https://example.test/api/contributions/private');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers['Content-Encoding'], 'br');
    assert.equal(calls[0].headers['X-Model-Tides-Report'], 'private-v1');
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(calls[1].url, 'https://example.test/api/contributions/public-id');
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].headers.Authorization, 'Bearer private-token');
    assert.equal(calls[1].headers['X-Model-Tides-Expected-Visibility'], 'private');
    assert.equal(calls[1].headers['X-Model-Tides-Report'], undefined);
    assert.deepEqual(calls[0].body, { format: 'model-tides-weekly', version: 1, weeks: [{
        week: '2026-09-28', models: { 'anthropic/claude-sonnet': 1, 'openai/gpt-5': 1 },
    }] });
    for (const key of ['events', 'time', 'kind', 'fromModel', 'fromTime', 'source', 'sessionId']) {
        assert.equal(JSON.stringify(calls[0].body).includes(`"${key}"`), false);
    }
});

test('CLI warns before replacing weeks in an already public report', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-public-replace-'));
    try {
        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        mkdirSync(join(home, 'model-tides'));
        writeFileSync(join(home, 'model-tides/contribution.json'), JSON.stringify({ id, token: 's'.repeat(43) }), { mode: 0o600 });
        const input = join(home, 'metadata.json');
        writeFileSync(input, JSON.stringify(doc));
        const preload = join(home, 'public-report.mjs');
        writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    if (url === 'https://modeltides.dev/api/contributions/${id}' && options?.method === undefined) {
        return Response.json({ id: '${id}', published: true, revision: 0,
            counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
    }
    throw new Error('No upload was authorized.');
};\n`);
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--import', preload,
            'scripts/contribute.mjs', 'upload', '--input', input], {
            cwd: new URL('../', import.meta.url), encoding: 'utf8', input: 'NO\n', timeout: 10_000,
            env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home,
                HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /already public.*reviewed counts.*public immediately/i);
        assert.doesNotMatch(result.stdout, /personal report stays private until you share it/i);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('CLI refuses replacement if the report visibility cannot be verified', async () => {
    const owner = { id: '0199abcf-22aa-7333-8abc-0123456789ab', token: 's'.repeat(43) };
    const calls = [];
    const fakeFetch = async (url, options) => {
        calls.push({ url, options });
        return Response.json({ id: owner.id, counts: [] }); // Old Worker responses omit visibility.
    };
    await assert.rejects(reportVisibility(owner, fakeFetch, 'https://example.test/api/contributions'),
        /Could not confirm personal report visibility. No upload was started/);
    assert.deepEqual(calls.map(({ url, options }) => ({ url, auth: options.headers.Authorization, method: options.method })), [
        { url: `https://example.test/api/contributions/${owner.id}`, auth: `Bearer ${owner.token}`, method: undefined },
    ]);
});

test('CLI rejects a metadata document carrying a private field before any upload', () => {
    assert.throws(() => snapshotFromDocuments([{ ...doc, sessionId: 'secret' }]), TypeError);
    assert.throws(() => snapshotFromDocuments([{ ...doc, source: 'example' }]), /Mock data/);
});

test('CLI sharing changes use only the owner key and never send metadata', async () => {
    const owner = { id: '0199abcf-22aa-7333-8abc-0123456789ab', token: 's'.repeat(43) };
    const calls = [];
    const endpoint = 'https://example.test/api/contributions';
    const fakeFetch = async (url, options) => {
        calls.push({ url, options });
        if (options.method === undefined) return Response.json({ id: owner.id, published: false, revision: 0,
            counts: [{ week: '2026-09-21', model: 'openai/gpt-5', count: 3 }] });
        const published = url.endsWith('/share');
        return Response.json({ id: owner.id, published, ...(published ? { url: `https://example.test/u/${owner.id}` } : {}) });
    };
    assert.equal((await setSharing(owner, true, fakeFetch, endpoint, { revision: 0,
        snapshot: { format: 'model-tides-weekly', version: 1, weeks: [
            { week: '2026-09-21', models: { 'openai/gpt-5': 3 } },
        ] } })).published, true);
    assert.equal((await setSharing(owner, false, fakeFetch, endpoint)).published, false);
    assert.deepEqual(calls.map(({ url, options }) => ({ url, method: options.method, authorization: options.headers.Authorization, body: options.body })), [
        { url: `${endpoint}/${owner.id}/share`, method: 'POST', authorization: `Bearer ${owner.token}`, body: undefined },
        { url: `${endpoint}/${owner.id}/unshare`, method: 'POST', authorization: `Bearer ${owner.token}`, body: undefined },
    ]);
    assert.equal(calls[0].options.headers['X-Model-Tides-Reviewed-Revision'], '0');
});

test('CLI shows every stored week before confirming personal report sharing', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-share-review-'));
    try {
        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        mkdirSync(join(home, 'model-tides'));
        writeFileSync(join(home, 'model-tides/contribution.json'), JSON.stringify({ id, token: 's'.repeat(43) }), { mode: 0o600 });
        const preload = join(home, 'report.mjs');
        writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    if (url === 'https://modeltides.dev/api/contributions/${id}' && options?.method === undefined)
        return Response.json({ id: '${id}', published: false, revision: 3, counts: [
            { week: '2026-09-21', model: 'older/model', count: 7 },
            { week: '2026-09-28', model: 'newer/model', count: 1 },
        ] });
    throw new Error('No share was authorized.');
};\n`);
        const result = spawnSync(process.execPath, ['--experimental-strip-types', '--import', preload,
            'scripts/contribute.mjs', 'share'], {
            cwd: new URL('../', import.meta.url), encoding: 'utf8', input: 'NO\n', timeout: 10_000,
            env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home,
                HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /2026-09-21[\s\S]*older\/model: 7/);
        assert.match(result.stdout, /2026-09-28[\s\S]*newer\/model: 1/);
        assert.match(result.stdout, /Type YES to confirm/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('CLI checks a committed sharing change when the response is lost', async () => {
    const owner = { id: '0199abcf-22aa-7333-8abc-0123456789ab', token: 's'.repeat(43) };
    const state = { published: false, readable: true, revision: 0 };
    const fetchImpl = async (_url, options) => {
        if (options.method === 'POST') { state.published = true; state.revision++; throw new Error('private response text'); }
        if (!state.readable) throw new Error('private response text');
        return Response.json({ id: owner.id, published: state.published, revision: state.revision,
            counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
    };
    const reviewed = { revision: 0, snapshot: { format: 'model-tides-weekly', version: 1, weeks: [
        { week: '2026-09-28', models: { 'openai/gpt-5': 1 } },
    ] } };
    assert.equal((await setSharing(owner, true, fetchImpl, 'https://example.test/api/contributions', reviewed)).published, true);
    state.readable = false;
    await assert.rejects(setSharing(owner, true, fetchImpl, 'https://example.test/api/contributions', reviewed),
        /change may have happened.*check.*before retrying/i);
});

test('CLI never reports a rejected share as successful after another session changes and publishes counts', async () => {
    const owner = { id: '0199abcf-22aa-7333-8abc-0123456789ab', token: 's'.repeat(43) };
    const fakeFetch = async (_url, options) => options.method === 'POST'
        ? Response.json({ error: 'Report changed.' }, { status: 409 })
        : Response.json({ id: owner.id, published: true, revision: 2,
            counts: [{ week: '2026-09-28', model: 'different/model', count: 9 }] });
    await assert.rejects(setSharing(owner, true, fakeFetch, 'https://example.test/api/contributions', {
        revision: 1, snapshot: { format: 'model-tides-weekly', version: 1, weeks: [
            { week: '2026-09-28', models: { 'openai/gpt-5': 1 } },
        ] },
    }),
        /changed|rejected|review/i);
});

test('an unlisted gist contains reviewed weekly counts, never private event metadata', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-gist-'));
    try {
        const input = join(home, 'metadata.json');
        const capture = join(home, 'gist-capture.json');
        writeFileSync(input, JSON.stringify(doc));
        writeFileSync(join(home, 'gh'), `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
if (process.argv[2] === 'api' && process.argv[3] === 'user') {
    process.stdout.write('BYK\\n');
    process.exit(0);
}
writeFileSync(process.env.GIST_CAPTURE, JSON.stringify({ args: process.argv.slice(2), content: readFileSync(0, 'utf8') }));
process.stdout.write('https://gist.github.com/0123456789abcdef0123456789abcdef\\n');
`, { mode: 0o700 });
        const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home,
            PATH: `${home}:${process.env.PATH}`, GIST_CAPTURE: capture,
            HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' };
        const run = (answer) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/contribute.mjs', 'gist', '--input', input], {
            cwd: new URL('../', import.meta.url), encoding: 'utf8', input: `${answer}\n`, env, timeout: 10_000,
        });
        const declined = run('NO');
        assert.equal(declined.status, 0, declined.stderr);
        assert.match(declined.stdout, /Anyone with the gist URL can read these counts/);
        assert.equal(existsSync(capture), false);
        const approved = run('YES');
        assert.equal(approved.status, 0, approved.stderr);
        assert.match(approved.stdout, /Unlisted gist: https:\/\/gist\.github\.com\//);
        assert.match(approved.stdout, /View in browser: https:\/\/modeltides\.dev\/gist#BYK\/0123456789abcdef0123456789abcdef/);
        const { args, content } = JSON.parse(readFileSync(capture, 'utf8'));
        assert.deepEqual(args, ['gist', 'create', '--filename', 'model-tides-weekly.json', '-']);
        assert.deepEqual(JSON.parse(content), snapshotFromDocuments([doc]));
        for (const privateKey of ['events', 'time', 'source', 'fromTime', 'fromModel', 'sessionId']) {
            assert.equal(content.includes(`"${privateKey}"`), false);
        }
        assert.equal(content.includes(String(doc.events[0].time)), false);
    } finally { rmSync(home, { recursive: true, force: true }); }
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

test('link prints only the existing public URL without scanning history or making a request', () => {
    const home = mkdtempSync(join(tmpdir(), 'model-tides-link-'));
    try {
        mkdirSync(join(home, 'model-tides'));
        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        const token = 's'.repeat(43);
        writeFileSync(join(home, 'model-tides/contribution.json'), JSON.stringify({ id, token }), { mode: 0o600 });
        const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/contribute.mjs', 'link'], {
            cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10_000,
            env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' },
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`^Public link: https://modeltides\\.dev/u/${id}\\n`));
        assert.match(result.stdout, /link works only while your personal report is shared/);
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
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
