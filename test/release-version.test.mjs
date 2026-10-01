import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bump = fileURLToPath(new URL('../scripts/bump-cli-version.mjs', import.meta.url));

test('Craft release changes only the CLI version and rejects invalid versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'model-tides-version-'));
    try {
        mkdirSync(join(root, 'scripts'));
        mkdirSync(join(root, 'cli'));
        copyFileSync(bump, join(root, 'scripts/bump-cli-version.mjs'));
        writeFileSync(join(root, 'package.json'), '{"name":"site","version":"1.0.0","private":true}\n');
        writeFileSync(join(root, 'cli/package.json'), '{"name":"model-tides","version":"1.0.1"}\n');
        const run = (version) => spawnSync(process.execPath, [join(root, 'scripts/bump-cli-version.mjs')], {
            encoding: 'utf8', env: { ...process.env, CRAFT_NEW_VERSION: version },
        });
        assert.equal(run('1.0.2').status, 0);
        assert.equal(JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8')).version, '1.0.2');
        assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), {
            name: 'site', version: '1.0.0', private: true,
        });
        assert.notEqual(run('1.0.2/other').status, 0);
        assert.equal(JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8')).version, '1.0.2');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
