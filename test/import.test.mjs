import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { extractOpenCodeUsage } from '../src/opencode-extract.ts';
import { parseUsageDocument } from '../src/usage-data.ts';

const firstTime = Date.UTC(2025, 0, 1);
const SQL = await initSqlJs();

function fixture() {
    const db = new SQL.Database();
    db.run('CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER)');
    db.run('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
    db.run('INSERT INTO session VALUES (?, ?)', ['private-session-id', firstTime]);
    const message = (id, time, data) => db.run('INSERT INTO message VALUES (?, ?, ?, ?)', [id, 'private-session-id', time, JSON.stringify(data)]);
    message('1', firstTime + 1_000, { role: 'user', content: 'secret user message' });
    message('2', firstTime + 2_000, { role: 'assistant', providerID: 'anthropic', modelID: 'claude-opus-4', content: 'secret response' });
    message('3', firstTime + 3_000, { role: 'assistant', providerID: 'anthropic', modelID: 'claude-opus-4', content: 'another secret response' });
    message('4', firstTime + 4_000, { role: 'assistant', providerID: 'openai', modelID: 'gpt-5', content: 'secret third response' });
    message('5', firstTime + 5_000, { role: 'assistant', providerID: 'openai', modelID: 'gpt-5', content: 'secret fourth response' });
    db.run('INSERT INTO session VALUES (?, ?)', ['second-private-session-id', firstTime + 6_000]);
    db.run('INSERT INTO message VALUES (?, ?, ?, ?)', ['6', 'second-private-session-id', firstTime + 7_000,
        JSON.stringify({ role: 'assistant', providerID: 'openai', modelID: 'gpt-5', content: 'secret fifth response' })]);
    return db;
}

test('browser and local exporter agree on starts and switches without disclosing messages or session IDs', () => {
    const db = fixture();
    const browserDocument = extractOpenCodeUsage(db);
    assert.deepEqual(browserDocument.events, [
        { time: firstTime, model: 'anthropic/claude-opus-4', kind: 'session' },
        { time: firstTime + 4_000, model: 'openai/gpt-5', kind: 'switch',
            fromModel: 'anthropic/claude-opus-4', fromTime: firstTime },
        { time: firstTime + 6_000, model: 'openai/gpt-5', kind: 'session' },
    ]);
    assert.doesNotMatch(JSON.stringify(browserDocument), /secret|private-session-id|content/);

    const directory = mkdtempSync(join(tmpdir(), 'model-currents-'));
    try {
        const path = join(directory, 'test.db');
        writeFileSync(path, db.export());
        const output = execFileSync('python3', ['scripts/export-model-currents.py', path], { encoding: 'utf8' });
        assert.deepEqual(parseUsageDocument(JSON.parse(output)), browserDocument);
        assert.doesNotMatch(output, /secret|private-session-id|content/);
    } finally {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test('metadata v1 rejects unknown versions, transcript fields, invalid switches, and oversized dates', () => {
    const good = { format: 'model-currents', version: 1, source: 'other-agent',
        events: [{ kind: 'session', time: firstTime, model: 'provider/model' }] };
    assert.deepEqual(parseUsageDocument(good), good);
    assert.throws(() => parseUsageDocument({ ...good, version: 2 }), /v1/);
    assert.throws(() => parseUsageDocument({ ...good, transcript: 'private' }), /v1/);
    assert.throws(() => parseUsageDocument({ ...good, events: [{ ...good.events[0], content: 'private' }] }), /invalid usage event/);
    assert.throws(() => parseUsageDocument({ ...good, events: [{ kind: 'switch', time: firstTime, model: 'provider/new' }] }), /invalid usage event/);
    assert.throws(() => parseUsageDocument({ ...good, events: [{ kind: 'session', time: Number.MAX_SAFE_INTEGER, model: 'provider/model' }] }), /invalid usage event/);
});

test('local exporter includes committed changes still held in a live WAL file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'model-currents-wal-'));
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
        const output = execFileSync('python3', ['-c', script, path, 'scripts/export-model-currents.py'], { encoding: 'utf8' });
        const document = parseUsageDocument(JSON.parse(output));
        assert.equal(document.events.length, 1);
        assert.deepEqual(document.events[0], { kind: 'session', time: firstTime, model: 'anthropic/claude-sonnet-4' });
        assert.doesNotMatch(output, /private/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
