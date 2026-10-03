import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
    } finally { db.close(); }

    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, 'config') };
    const help = spawnSync(command, ['help'], { encoding: 'utf8', env, timeout: 20_000 });
    assert.ifError(help.error);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /upload.*contribute.*withdraw/s);
    const output = join(root, 'metadata.json');
    const exported = spawnSync(command, ['export', '--output', output], { encoding: 'utf8', env, timeout: 20_000 });
    assert.ifError(exported.error);
    assert.equal(exported.status, 0, exported.stderr);
    const json = readFileSync(output, 'utf8');
    assert.deepEqual(JSON.parse(json), { format: 'model-tides', version: 1, source: 'opencode', events: [
        { time: Date.UTC(2026, 8, 28), model: 'openai/gpt-5', kind: 'session' },
    ] });
    assert.doesNotMatch(json, /private-(?:session|message)|private prompt and reply/);
    console.log('Standalone help and synthetic read-only SQLite export passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
