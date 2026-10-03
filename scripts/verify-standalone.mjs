import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = process.argv[2];
if (!binary) throw new Error('Pass the host-platform Model Tides binary.');
const command = resolve(binary);
const root = mkdtempSync(join(tmpdir(), 'model-tides-standalone-'));
try {
    const home = join(root, 'home');
    const data = join(home, '.local/share/opencode');
    mkdirSync(data, { recursive: true });
    const db = new DatabaseSync(join(data, 'opencode.db'));
    try {
        db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER);
            CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);`);
        db.prepare('INSERT INTO session VALUES (?, ?)').run('private-session-id', Date.UTC(2026, 8, 28));
        db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('private-message-id', 'private-session-id',
            Date.UTC(2026, 8, 28, 12), JSON.stringify({ role: 'assistant', providerID: 'openai', modelID: 'gpt-5', content: 'private prompt and reply' }));
        db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('private-message-2', 'private-session-id',
            Date.UTC(2026, 8, 28, 16), JSON.stringify({ role: 'assistant', providerID: 'openai', modelID: 'gpt-5' }));
        db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('private-message-3', 'private-session-id',
            Date.UTC(2026, 8, 29, 11), JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }));
    } finally { db.close(); }

    const bin = join(root, 'bin');
    mkdirSync(bin);
    symlinkSync(command, join(bin, 'model-tides'));
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, 'config'),
        XDG_DATA_HOME: join(root, 'data'), PATH: `${bin}:${process.env.PATH ?? ''}` };
    const help = spawnSync('model-tides', ['--help'], { encoding: 'utf8', env, cwd: root, timeout: 20_000 });
    assert.ifError(help.error);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /upload.*contribute.*withdraw/s);
    const bare = spawnSync('model-tides', [], { encoding: 'utf8', env, cwd: root, timeout: 20_000 });
    assert.ifError(bare.error);
    assert.equal(bare.status, 0, bare.stderr);
    assert.match(bare.stdout, /Usage: model-tides/);
    const output = join(root, 'metadata.json');
    const exported = spawnSync('model-tides', ['export', '--output', output], { encoding: 'utf8', env, cwd: root, timeout: 20_000 });
    assert.ifError(exported.error);
    assert.equal(exported.status, 0, exported.stderr);
    const json = readFileSync(output, 'utf8');
    assert.deepEqual(JSON.parse(json), { format: 'model-tides-daily', version: 2, source: 'opencode', days: [
        { day: '2026-09-28', models: { 'openai/gpt-5': 1 } },
        { day: '2026-09-29', models: { 'anthropic/claude-sonnet-4-5': 1 } },
    ] });
    assert.doesNotMatch(json, /private-(?:session|message)|private prompt and reply/);
    console.log('Standalone help and synthetic read-only SQLite export passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
