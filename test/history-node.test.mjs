import assert from 'node:assert/strict';
import { createWriteStream, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createZstdCompress } from 'node:zlib';
import { exportLocalMetadata } from '../scripts/contribute.mjs';

const at = (seconds) => new Date(Date.UTC(2025, 0, 1) + seconds * 1000).toISOString();
const source = (name, path) => ({ name, path });

test('Node SQLite reads committed live WAL without changing database or sidecars, and exports no private data', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tides-node-sqlite-'));
    const path = join(home, 'history.db');
    const db = new DatabaseSync(path);
    try {
        db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
        const started = Date.UTC(2025, 0, 1);
        db.prepare('INSERT INTO session VALUES (?, ?)').run('private-session-id', started);
        const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
        insert.run('private-message-1', 'private-session-id', started + 1000,
            JSON.stringify({ role: 'assistant', providerID: 'openai', modelID: 'gpt-5', content: 'private reply' }));
        insert.run('private-message-2', 'private-session-id', started + 2000,
            JSON.stringify({ role: 'assistant', providerID: 'openai', modelID: 'gpt-5' }));
        insert.run('private-message-3', 'private-session-id', started + 3000,
            JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-sonnet', content: 'private prompt' }));
        assert.equal(statSync(`${path}-wal`).size > 0, true);
        const before = [path, `${path}-wal`].map((file) => readFileSync(file));
        const result = await exportLocalMetadata([source('OpenCode', path)]);
        assert.deepEqual(result.events, [
            { time: started, model: 'openai/gpt-5', kind: 'session' },
            { time: started + 3000, model: 'anthropic/claude-sonnet', kind: 'switch', fromModel: 'openai/gpt-5', fromTime: started },
        ]);
        assert.doesNotMatch(JSON.stringify(result), /private|content|session_id|message_id/i);
        for (const [index, file] of [path, `${path}-wal`].entries()) {
            assert.deepEqual(readFileSync(file), before[index]);
        }
        // SQLite uses transient read locks in the shared-memory sidecar while the writer is live.
        assert.equal(statSync(`${path}-shm`).size > 0, true);
    } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test('Node zstd reads old Codex rollouts without external tools, prefers plain siblings, and fails closed on corrupt frames', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tides-node-zstd-'));
    try {
        const root = join(home, 'sessions');
        mkdirSync(root);
        const plain = join(root, 'rollout-old.jsonl');
        const compressed = `${plain}.zst`;
        const meta = { type: 'session_meta', timestamp: at(0), payload: { id: 'private-session', timestamp: at(0), cwd: '/private/path' } };
        const history = [meta, { type: 'turn_context', timestamp: at(1), payload: { model: 'gpt-4o', instructions: 'private prompt' } }]
            .map(JSON.stringify).join('\n') + '\n';
        await pipeline(Readable.from([history]), createZstdCompress(), createWriteStream(compressed));
        const scan = () => exportLocalMetadata([source('Codex', root)]);
        assert.deepEqual((await scan()).events, [{ time: Date.UTC(2025, 0, 1), model: 'openai/gpt-4o', kind: 'session' }]);
        writeFileSync(plain, [JSON.stringify(meta), JSON.stringify({ type: 'turn_context', timestamp: at(1), payload: { model: 'gpt-5' } })].join('\n') + '\n');
        assert.deepEqual((await scan()).events, [{ time: Date.UTC(2025, 0, 1), model: 'openai/gpt-5', kind: 'session' }]);
        rmSync(plain);
        writeFileSync(compressed, 'corrupted private frame');
        await assert.rejects(scan(), /Codex could not be read/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Node JSONL ignores only an incomplete plain final record, rejects malformed complete lines and symlink roots', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tides-node-lines-'));
    try {
        const file = join(home, 'rollout-main.jsonl');
        const prefix = [
            { type: 'session_meta', timestamp: at(0), payload: { id: 'private-session', timestamp: at(0) } },
            { type: 'turn_context', timestamp: at(1), payload: { model: 'gpt-5' } },
        ].map(JSON.stringify).join('\n') + '\n';
        writeFileSync(file, prefix + '{"private transcript":');
        const scan = (path) => exportLocalMetadata([source('Codex', path)]);
        assert.equal((await scan(file)).events[0].model, 'openai/gpt-5');
        writeFileSync(file, prefix + '{"private transcript":\n');
        await assert.rejects(scan(file), /Codex.*malformed history record/i);
        writeFileSync(file, prefix + '{"private transcript":garbage');
        await assert.rejects(scan(file), /Codex.*malformed history record/i);
        const link = join(home, 'linked.jsonl');
        symlinkSync(file, link);
        await assert.rejects(scan(link), /Codex could not be read/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Node Codex merges repeated rollout sessions, orders switches by time, and skips subagents', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tides-node-codex-'));
    try {
        const root = join(home, 'sessions');
        mkdirSync(root);
        const meta = { type: 'session_meta', payload: { id: 'private-id', timestamp: at(0), model_provider: 'openai', base_instructions: 'private prompt' } };
        const turn = (seconds, model) => ({ type: 'turn_context', timestamp: at(seconds), payload: { model, content: 'private reply' } });
        writeFileSync(join(root, 'rollout-main.jsonl'), [meta, turn(4, 'gpt-5'), turn(1, 'gpt-5'), turn(3, 'gpt-5-codex')].map(JSON.stringify).join('\n') + '\n');
        writeFileSync(join(root, 'rollout-repeat.jsonl'), [meta, turn(1, 'gpt-5')].map(JSON.stringify).join('\n') + '\n');
        writeFileSync(join(root, 'rollout-agent.jsonl'), [
            { type: 'session_meta', payload: { id: 'private-agent', parent_thread_id: 'private-id', timestamp: at(0) } },
            turn(2, 'gpt-5-nano'),
        ].map(JSON.stringify).join('\n') + '\n');
        const result = await exportLocalMetadata([source('Codex', root)]);
        assert.deepEqual(result.events, [
            { time: Date.UTC(2025, 0, 1), model: 'openai/gpt-5', kind: 'session' },
            { time: Date.UTC(2025, 0, 1) + 3000, model: 'openai/gpt-5-codex', kind: 'switch', fromModel: 'openai/gpt-5', fromTime: Date.UTC(2025, 0, 1) },
            { time: Date.UTC(2025, 0, 1) + 4000, model: 'openai/gpt-5', kind: 'switch', fromModel: 'openai/gpt-5-codex', fromTime: Date.UTC(2025, 0, 1) + 3000 },
        ]);
        assert.doesNotMatch(JSON.stringify(result), /private|prompt|reply|sessionId|messageId/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Node Claude Code counts main-thread assistant messages once, from the first user turn', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tides-node-claude-'));
    try {
        const root = join(home, 'projects');
        mkdirSync(root);
        const message = (seconds, id, model) => ({ type: 'assistant', timestamp: at(seconds), message: {
            id, role: 'assistant', model, content: 'private reply',
        } });
        writeFileSync(join(root, 'main.jsonl'), [
            { type: 'user', timestamp: at(0), message: { content: 'private prompt' } },
            message(1, 'private-message', 'claude-sonnet-4-5'),
            message(2, 'private-message', 'claude-sonnet-4-5'),
            { ...message(3, 'child', 'claude-haiku-4-5'), isSidechain: true },
            message(4, 'private-switch', 'claude-opus-4-6'),
        ].map(JSON.stringify).join('\n') + '\n');
        writeFileSync(join(root, 'agent-other.jsonl'), JSON.stringify(message(5, 'agent', 'claude-haiku-4-5')) + '\n');
        const subagents = join(root, 'subagents');
        mkdirSync(subagents);
        const child = join(subagents, 'child.jsonl');
        writeFileSync(child, JSON.stringify(message(5, 'child', 'claude-haiku-4-5')) + '\n');
        await assert.rejects(exportLocalMetadata([source('Claude Code', child)]), /No model observations found/);
        const result = await exportLocalMetadata([source('Claude Code', root)]);
        assert.deepEqual(result.events, [
            { time: Date.UTC(2025, 0, 1), model: 'anthropic/claude-sonnet-4-5', kind: 'session' },
            { time: Date.UTC(2025, 0, 1) + 4000, model: 'anthropic/claude-opus-4-6', kind: 'switch', fromModel: 'anthropic/claude-sonnet-4-5', fromTime: Date.UTC(2025, 0, 1) },
        ]);
        assert.doesNotMatch(JSON.stringify(result), /private|prompt|reply|sessionId|messageId/);
    } finally { rmSync(home, { recursive: true, force: true }); }
});
