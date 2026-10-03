import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseUsageDocument } from '../src/usage-data.ts';

const firstTime = Date.UTC(2025, 0, 1);
test('local OpenCode exporter keeps starts and switches without disclosing messages or session IDs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'model-tides-'));
    try {
        const path = join(directory, 'test.db');
        const fixture = `
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute('CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER)')
db.execute('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)')
db.execute('INSERT INTO session VALUES (?, ?)', ('private-session-id', 1735689600000))
def message(id, session, time, role, provider, model):
    db.execute('INSERT INTO message VALUES (?, ?, ?, ?)', (id, session, time,
        json.dumps({'role': role, 'providerID': provider, 'modelID': model, 'content': 'secret response'})))
message('1', 'private-session-id', 1735689601000, 'user', None, None)
message('2', 'private-session-id', 1735689602000, 'assistant', 'anthropic', 'claude-opus-4')
message('3', 'private-session-id', 1735689603000, 'assistant', 'anthropic', 'claude-opus-4')
message('4', 'private-session-id', 1735689604000, 'assistant', 'openai', 'gpt-5')
message('5', 'private-session-id', 1735689605000, 'assistant', 'openai', 'gpt-5')
db.execute('INSERT INTO session VALUES (?, ?)', ('second-private-session-id', 1735689606000))
message('6', 'second-private-session-id', 1735689607000, 'assistant', 'openai', 'gpt-5')
db.commit()
db.close()
`;
        execFileSync('python3', ['-c', fixture, path]);
        const output = execFileSync('python3', ['scripts/export-model-tides.py', path], { encoding: 'utf8' });
        const document = parseUsageDocument(JSON.parse(output));
        assert.deepEqual(document.events, [
            { time: firstTime, model: 'anthropic/claude-opus-4', kind: 'session' },
            { time: firstTime + 4_000, model: 'openai/gpt-5', kind: 'switch',
                fromModel: 'anthropic/claude-opus-4', fromTime: firstTime },
            { time: firstTime + 6_000, model: 'openai/gpt-5', kind: 'session' },
        ]);
        assert.doesNotMatch(output, /secret|private-session-id|content/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('metadata v1 rejects unknown versions, transcript fields, invalid switches, and oversized dates', () => {
    const good = { format: 'model-tides', version: 1, source: 'other-agent',
        events: [{ kind: 'session', time: firstTime, model: 'provider/model' }] };
    assert.deepEqual(parseUsageDocument(good), good);
    assert.deepEqual(parseUsageDocument({ ...good, format: 'model-currents' }), good);
    assert.throws(() => parseUsageDocument({ ...good, format: 'unrelated' }), /v1/);
    assert.throws(() => parseUsageDocument({ ...good, version: 2 }), /v1/);
    assert.throws(() => parseUsageDocument({ ...good, transcript: 'private' }), /v1/);
    assert.throws(() => parseUsageDocument({ ...good, events: [{ ...good.events[0], content: 'private' }] }), /invalid usage event/);
    assert.throws(() => parseUsageDocument({ ...good, events: [{ kind: 'switch', time: firstTime, model: 'provider/new' }] }), /invalid usage event/);
    assert.throws(() => parseUsageDocument({ ...good, events: [{ kind: 'session', time: Number.MAX_SAFE_INTEGER, model: 'provider/model' }] }), /invalid usage event/);
});

test('local exporter includes committed changes still held in a live WAL file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'model-tides-wal-'));
    try {
        const path = join(directory, 'active.db');
        const script = `
import json, sqlite3, subprocess, sys
db = sqlite3.connect(sys.argv[1])
db.execute('PRAGMA journal_mode=WAL')
db.execute('CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER)')
db.execute('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)')
db.execute('INSERT INTO session VALUES (?, ?)', ('private-id', 1735689600000))
db.execute('INSERT INTO message VALUES (?, ?, ?, ?)', ('1', 'private-id', 1735689601000,
    json.dumps({'role': 'assistant', 'providerID': 'anthropic', 'modelID': 'claude-sonnet-4', 'content': 'private'})))
db.commit()
print(subprocess.check_output(['python3', sys.argv[2], sys.argv[1]], text=True))
db.close()
`;
        const output = execFileSync('python3', ['-c', script, path, 'scripts/export-model-tides.py'], { encoding: 'utf8' });
        const document = parseUsageDocument(JSON.parse(output));
        assert.equal(document.events.length, 1);
        assert.deepEqual(document.events[0], { kind: 'session', time: firstTime, model: 'anthropic/claude-sonnet-4' });
        assert.doesNotMatch(output, /private/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
