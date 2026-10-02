import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseUsageDocument } from '../src/usage-data.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('npm package includes the local converters, metadata validator, and command, without the app or Worker', () => {
    const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const cli = JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8'));
    assert.equal(app.private, true, 'never publish the site source as the CLI');
    assert.equal(cli.name, 'model-tides');
    assert.deepEqual(cli.bin, { 'model-tides': 'dist/scripts/contribute.mjs' });
    const output = execFileSync('npm', ['pack', './cli', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
    const [packageInfo] = JSON.parse(output);
    const names = packageInfo.files.map((file) => file.path).sort();
    assert.deepEqual(names, [
        'LICENSE', 'README.md',
        'dist/scripts/contribute.mjs', 'dist/scripts/export-history.py', 'dist/scripts/export-model-tides.py',
        'dist/src/usage-data.js', 'dist/src/weekly-snapshot.js', 'package.json',
    ]);
    assert.equal(packageInfo.name, 'model-tides');
    assert.equal(packageInfo.version, cli.version);
    const directory = mkdtempSync(join(tmpdir(), 'model-tides-bin-'));
    try {
        const bin = join(directory, 'model-tides');
        symlinkSync(join(root, 'cli/dist/scripts/contribute.mjs'), bin);
        assert.throws(() => execFileSync('node', [bin, 'upload', '--wrong'], {
            cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }), (error) => error.status === 1 && /Usage: model-tides upload/.test(error.stderr));
        const file = join(directory, 'metadata.json');
        writeFileSync(file, JSON.stringify({
            format: 'model-tides', version: 1, source: 'test',
            events: [{ time: Date.UTC(2026, 8, 28), kind: 'session', model: 'openai/gpt-5' }],
        }));
        const interceptor = join(directory, 'registry.mjs');
        writeFileSync(interceptor, 'globalThis.fetch = () => { throw new Error("Unexpected network request before consent."); };');
        const review = execFileSync('node', ['--import', interceptor, bin, 'upload', '--input', file], {
            cwd: directory, encoding: 'utf8', input: 'NO\n',
            env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory },
        });
        assert.match(review, /Week of 2026-09-28\s+openai\/gpt-5: 1/);
        assert.match(review, /Type YES to confirm/);
        assert.doesNotMatch(review, /Public link:/);

        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        const token = 's'.repeat(43);
        writeFileSync(interceptor, `globalThis.fetch = async (url, options) => {
            if (url !== 'https://modeltides.dev/api/contributions/private' || options?.method !== 'POST') {
                throw new Error('Unexpected network request: ' + String(url) + ' ' + String(options?.method));
            }
            return Response.json({ id: '${id}', token: '${token}', published: false }, { status: 201 });
        };`);
        const environment = { ...process.env, HOME: directory, XDG_CONFIG_HOME: join(directory, 'config') };
        const uploaded = execFileSync('node', ['--import', interceptor, bin, 'upload', '--input', file], {
            cwd: directory, encoding: 'utf8', input: 'YES\n', env: environment,
        });
        assert.match(uploaded, /personal report is private/);
        assert.doesNotMatch(uploaded, /Public link:/);
        assert.doesNotMatch(uploaded, new RegExp(token));
        const savedKey = join(directory, 'config/model-tides/contribution.json');
        assert.equal(statSync(savedKey).mode & 0o777, 0o600);
        const repeatedLink = execFileSync('node', [bin, 'link'], { cwd: directory, encoding: 'utf8', env: environment });
        assert.match(repeatedLink, new RegExp(`^Public link: https://modeltides\\.dev/u/${id}\\n`));
        assert.match(repeatedLink, /link works only while your personal report is shared/);
        assert.doesNotMatch(repeatedLink, new RegExp(token));

        writeFileSync(interceptor, `globalThis.fetch = async (url, options) => {
            if (url === 'https://modeltides.dev/api/contributions/${id}' && options?.method === undefined) {
                return Response.json({ id: '${id}', published: false, revision: 0,
                    counts: [{ week: '2026-09-28', model: 'openai/gpt-5', count: 1 }] });
            }
            if (options?.method !== 'POST' || options?.headers?.Authorization !== 'Bearer ${token}') {
                throw new Error('Share requires the existing owner key.');
            }
            if (url === 'https://modeltides.dev/api/contributions/${id}/share') {
                if (options.headers['X-Model-Tides-Reviewed-Revision'] !== '0') throw new Error('Reviewed revision required.');
                return Response.json({ id: '${id}', published: true, url: 'https://modeltides.dev/u/${id}' });
            }
            if (url === 'https://modeltides.dev/api/contributions/${id}/unshare') {
                return Response.json({ id: '${id}', published: false });
            }
            throw new Error('Unexpected sharing request.');
        };`);
        const shared = execFileSync('node', ['--import', interceptor, bin, 'share'], {
            cwd: directory, encoding: 'utf8', input: 'YES\n', env: environment,
        });
        assert.match(shared, /Week of 2026-09-28\s+openai\/gpt-5: 1/);
        assert.match(shared, new RegExp(`Public link: https://modeltides\\.dev/u/${id}`));
        const hidden = execFileSync('node', ['--import', interceptor, bin, 'unshare'], {
            cwd: directory, encoding: 'utf8', input: 'YES\n', env: environment,
        });
        assert.match(hidden, /personal report is hidden/);

        const history = join(directory, '.codex/sessions/2025/01/01');
        mkdirSync(history, { recursive: true });
        writeFileSync(join(history, 'rollout-test.jsonl'), [
            { timestamp: '2025-01-01T00:00:00Z', type: 'session_meta', payload: { id: 'private-id', timestamp: '2025-01-01T00:00:00Z' } },
            { timestamp: '2025-01-01T00:00:01Z', type: 'turn_context', payload: { model: 'gpt-5', content: 'private prompt' } },
        ].map(JSON.stringify).join('\n') + '\n');
        const exportPath = join(directory, 'export.json');
        const saved = execFileSync('node', [bin, 'export', '--output', exportPath], {
            cwd: directory, encoding: 'utf8', env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory },
        });
        assert.match(saved, /modeltides\.dev\/local\//);
        const exported = readFileSync(exportPath, 'utf8');
        assert.deepEqual(parseUsageDocument(JSON.parse(exported)).events, [
            { time: Date.UTC(2025, 0, 1), model: 'openai/gpt-5', kind: 'session' },
        ]);
        assert.doesNotMatch(exported, /private|prompt|content|session_meta/i);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
