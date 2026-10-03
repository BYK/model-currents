import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const installer = new URL('../public/install.sh', import.meta.url);

function runInstaller({ os = 'Linux', arch = 'x86_64', checksum = true, version = '1.2.3' } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'model-tides-installer-'));
    const binary = Buffer.from('synthetic executable, never published');
    const name = `model-tides-${os === 'Darwin' ? 'darwin' : 'linux'}-${arch === 'aarch64' || arch === 'arm64' ? 'arm64' : 'x64'}`;
    const digest = createHash('sha256').update(binary).digest('hex');
    writeFileSync(join(root, 'binary'), binary);
    writeFileSync(join(root, 'checksums'), `${checksum ? digest : '0'.repeat(64)}  ${name}\n`);
    writeFileSync(join(root, 'uname'), '#!/usr/bin/env bash\nif [[ "$1" == "-s" ]]; then echo "$FAKE_OS"; else echo "$FAKE_ARCH"; fi\n', { mode: 0o755 });
    writeFileSync(join(root, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
url=''
output=''
while (( $# )); do
    case "$1" in
        -o) output="$2"; shift 2 ;;
        *) url="$1"; shift ;;
    esac
done
printf '%s\\n' "$url" >> "$FAKE_REQUESTS"
case "$url" in
    */SHA256SUMS) cp "$FAKE_CHECKSUMS" "$output" ;;
    */model-tides-*) cp "$FAKE_BINARY" "$output" ;;
    *) exit 1 ;;
esac
`, { mode: 0o755 });
    const destination = join(root, 'bin');
    const result = spawnSync('bash', [installer.pathname], { encoding: 'utf8', timeout: 10_000, env: {
        ...process.env, PATH: `${root}:${process.env.PATH}`, FAKE_OS: os, FAKE_ARCH: arch,
        FAKE_BINARY: join(root, 'binary'), FAKE_CHECKSUMS: join(root, 'checksums'), FAKE_REQUESTS: join(root, 'requests'),
        MODEL_TIDES_VERSION: version, MODEL_TIDES_INSTALL_DIR: destination,
    } });
    return { root, binary, destination, result, requests: () => readFileSync(join(root, 'requests'), 'utf8') };
}

test('the installer pins a requested version, verifies SHA-256, and installs only the chosen binary', () => {
    const run = runInstaller();
    try {
        assert.equal(run.result.status, 0, run.result.stderr);
        assert.deepEqual(readFileSync(join(run.destination, 'model-tides')), run.binary);
        assert.equal(statSync(join(run.destination, 'model-tides')).mode & 0o777, 0o755);
        assert.deepEqual(run.requests().trim().split('\n'), [
            'https://github.com/BYK/model-tides/releases/download/1.2.3/SHA256SUMS',
            'https://github.com/BYK/model-tides/releases/download/1.2.3/model-tides-linux-x64',
        ]);
    } finally { rmSync(run.root, { recursive: true, force: true }); }
});

test('the installer selects a macOS arm64 binary without requiring Node or Python', () => {
    const run = runInstaller({ os: 'Darwin', arch: 'arm64' });
    try {
        assert.equal(run.result.status, 0, run.result.stderr);
        assert.match(run.requests(), /model-tides-darwin-arm64/);
    } finally { rmSync(run.root, { recursive: true, force: true }); }
});

test('checksum mismatch and unsupported platforms never install a binary', () => {
    const mismatch = runInstaller({ checksum: false });
    try {
        assert.notEqual(mismatch.result.status, 0);
        assert.match(mismatch.result.stderr, /Checksum mismatch/);
        assert.throws(() => readFileSync(join(mismatch.destination, 'model-tides')));
    } finally { rmSync(mismatch.root, { recursive: true, force: true }); }
    const unsupported = runInstaller({ os: 'FreeBSD' });
    try {
        assert.notEqual(unsupported.result.status, 0);
        assert.match(unsupported.result.stderr, /supports Linux and macOS/);
        assert.throws(() => readFileSync(join(unsupported.destination, 'model-tides')));
    } finally { rmSync(unsupported.root, { recursive: true, force: true }); }
});

test('the installer rejects malformed release versions before any download', () => {
    const run = runInstaller({ version: '1.2.3/../../bad' });
    try {
        assert.notEqual(run.result.status, 0);
        assert.match(run.result.stderr, /MODEL_TIDES_VERSION must be/);
        assert.throws(run.requests);
    } finally { rmSync(run.root, { recursive: true, force: true }); }
});
