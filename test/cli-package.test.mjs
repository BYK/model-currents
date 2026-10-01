import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('npm package includes the local converters, metadata validator, and command, without the app or Worker', () => {
    const output = execFileSync('npm', ['pack', './cli', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
    const [packageInfo] = JSON.parse(output);
    const names = packageInfo.files.map((file) => file.path).sort();
    assert.deepEqual(names, [
        'LICENSE', 'README.md',
        'dist/scripts/contribute.mjs', 'dist/scripts/export-history.py', 'dist/scripts/export-model-tides.py',
        'dist/src/usage-data.js', 'dist/src/weekly-snapshot.js', 'package.json',
    ]);
    assert.equal(packageInfo.name, 'model-tides');
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
        writeFileSync(interceptor, `globalThis.fetch = async (url, options) => {
            if (url !== 'https://modeltides.dev/api/models' || options?.body || options?.method) {
                throw new Error('Unexpected request during offline CLI packaging test.');
            }
            return Response.json({ models: ['openai/gpt-5'] });
        };`);
        const review = execFileSync('node', ['--import', interceptor, bin, 'upload', '--input', file], {
            cwd: directory, encoding: 'utf8', input: 'NO\n',
            env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory },
        });
        assert.match(review, /Week of 2026-09-28\s+openai\/gpt-5: 1/);
        assert.match(review, /Type YES to confirm/);
        assert.doesNotMatch(review, /Public link:/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
