import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { parseUsageDocument } from '../src/usage-data.ts';

const start = Date.UTC(2025, 0, 1);
const timestamp = (offset) => new Date(start + offset).toISOString();
const script = 'scripts/export-history.py';

function writeHistory(path, records) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

function exportHistory(source, path) {
    const output = execFileSync('python3', [script, source, path], { encoding: 'utf8' });
    return { output, document: parseUsageDocument(JSON.parse(output)) };
}

test('Codex rollouts count session starts and turn-context model changes once, never exporting private fields', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-codex-'));
    try {
        const main = join(directory, 'sessions/2025/01/01/rollout-main.jsonl');
        const meta = { timestamp: timestamp(0), type: 'session_meta', payload: {
            id: 'private-codex-id', timestamp: timestamp(0), source: 'cli', model_provider: 'openai',
            cwd: '/private/project', base_instructions: 'private prompt',
        } };
        const first = { timestamp: timestamp(1000), type: 'turn_context', payload: { model: 'gpt-5', instructions: 'private transcript' } };
        writeHistory(main, [meta, first,
            { timestamp: timestamp(2000), type: 'turn_context', payload: { model: 'gpt-5' } },
            { timestamp: timestamp(3000), type: 'response_item', payload: { model: 'leaked', content: 'private reply' } },
            { timestamp: timestamp(4000), type: 'turn_context', payload: { model: 'gpt-5-codex' } },
            { timestamp: timestamp(5000), type: 'turn_context', payload: { model: 'gpt-5-codex' } },
        ]);
        writeHistory(join(directory, 'archived_sessions/rollout-copy.jsonl'), [meta, first]);
        writeHistory(join(directory, 'sessions/2025/01/01/rollout-agent.jsonl'), [
            { timestamp: timestamp(6000), type: 'session_meta', payload: {
                id: 'private-agent-id', parent_thread_id: 'private-codex-id', source: { subAgent: 'spawn' },
                model_provider: 'openai', timestamp: timestamp(6000),
            } },
            { timestamp: timestamp(7000), type: 'turn_context', payload: { model: 'gpt-5-nano' } },
        ]);
        const { output, document } = exportHistory('codex', directory);
        assert.deepEqual(document, { format: 'model-tides', version: 1, source: 'codex', events: [
            { time: start, model: 'openai/gpt-5', kind: 'session' },
            { time: start + 4000, model: 'openai/gpt-5-codex', kind: 'switch', fromModel: 'openai/gpt-5', fromTime: start },
        ] });
        assert.doesNotMatch(output, /private|instructions|content|session_meta|turn_context|leaked/i);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Codex converter skips model IDs that exceed the browser UTF-16 limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-unicode-'));
    try {
        const file = join(directory, 'rollout-unicode.jsonl');
        writeHistory(file, [
            { timestamp: timestamp(0), type: 'session_meta', payload: {
                id: 'private-id', timestamp: timestamp(0), source: 'cli', model_provider: 'openai',
            } },
            { timestamp: timestamp(1000), type: 'turn_context', payload: { model: 'gpt-5' } },
            { timestamp: timestamp(2000), type: 'turn_context', payload: { model: '🫧'.repeat(161) } },
            { timestamp: timestamp(3000), type: 'turn_context', payload: { model: '🫧'.repeat(160) } },
        ]);
        const { output, document } = exportHistory('codex', file);
        assert.deepEqual(document.events, [{ time: start, model: 'openai/gpt-5', kind: 'session' }]);
        assert.doesNotMatch(output, /🫧|private-id/u);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Claude Code JSONL counts only main-thread assistant models, de-duplicates message updates, and omits transcripts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-claude-'));
    try {
        const projects = join(directory, 'projects');
        writeHistory(join(projects, '-private-project/main.jsonl'), [
            { type: 'user', timestamp: timestamp(0), message: { role: 'user', content: 'private prompt' }, sessionId: 'private-id' },
            { type: 'assistant', timestamp: timestamp(1000), message: { role: 'assistant', id: 'private-msg-1', model: 'claude-sonnet-4-5', content: 'private answer' } },
            { type: 'assistant', timestamp: timestamp(1500), message: { role: 'assistant', id: 'private-msg-1', model: 'claude-sonnet-4-5', content: 'updated answer' } },
            { type: 'assistant', timestamp: timestamp(2000), isSidechain: true, message: { role: 'assistant', model: 'claude-haiku-4-5' } },
            { type: 'assistant', timestamp: timestamp(3000), message: { role: 'assistant', id: 'private-msg-2', model: 'claude-opus-4-6', content: 'private other answer' } },
            { type: 'assistant', timestamp: timestamp(4000), message: { role: 'assistant', id: 'private-msg-1', model: 'claude-sonnet-4-5', content: 'late duplicate' } },
        ]);
        writeHistory(join(projects, '-private-project/agent-child.jsonl'), [
            { type: 'assistant', timestamp: timestamp(5000), message: { role: 'assistant', model: 'claude-haiku-4-5' } },
        ]);
        writeHistory(join(projects, '-private-project/subagents/agent-other.jsonl'), [
            { type: 'assistant', timestamp: timestamp(5000), message: { role: 'assistant', model: 'claude-haiku-4-5' } },
        ]);
        writeHistory(join(projects, '-private-project/second.jsonl'), [
            { type: 'assistant', timestamp: timestamp(6000), message: { role: 'assistant', model: 'claude-haiku-4-5', content: 'private' } },
            { type: 'assistant', timestamp: timestamp(7000), message: { role: 'assistant', model: '<synthetic>' } },
        ]);
        const { output, document } = exportHistory('claude-code', directory);
        assert.deepEqual(document, { format: 'model-tides', version: 1, source: 'claude-code', events: [
            { time: start, model: 'anthropic/claude-sonnet-4-5', kind: 'session' },
            { time: start + 3000, model: 'anthropic/claude-opus-4-6', kind: 'switch', fromModel: 'anthropic/claude-sonnet-4-5', fromTime: start },
            { time: start + 6000, model: 'anthropic/claude-haiku-4-5', kind: 'session' },
        ] });
        assert.doesNotMatch(output, /private|content|sessionId|message|synthetic/i);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Claude Code accepts Bedrock-prefixed Claude model IDs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-bedrock-'));
    try {
        const file = join(directory, 'main.jsonl');
        writeHistory(file, [
            { timestamp: timestamp(0), type: 'assistant', message: { role: 'assistant', model: 'anthropic.claude-sonnet-4-20250514-v1:0' } },
            { timestamp: timestamp(1000), type: 'assistant', message: { role: 'assistant', model: 'us.anthropic.claude-opus-4-20250514-v1:0' } },
        ]);
        assert.deepEqual(exportHistory('claude-code', file).document.events, [
            { time: start, model: 'anthropic/anthropic.claude-sonnet-4-20250514-v1:0', kind: 'session' },
            { time: start + 1000, model: 'anthropic/us.anthropic.claude-opus-4-20250514-v1:0', kind: 'switch',
                fromModel: 'anthropic/anthropic.claude-sonnet-4-20250514-v1:0', fromTime: start },
        ]);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('Codex includes older zstd-compressed rollouts and prefers a plain sibling', (t) => {
    if (spawnSync('zstd', ['--version']).status !== 0) return t.skip('zstd is not installed');
    const directory = mkdtempSync(join(tmpdir(), 'tides-zstd-'));
    try {
        const plain = join(directory, 'archived_sessions/rollout-old.jsonl');
        writeHistory(plain, [
            { timestamp: timestamp(0), type: 'session_meta', payload: { id: 'private-old-id', timestamp: timestamp(0), source: 'cli' } },
            { timestamp: timestamp(1000), type: 'turn_context', payload: { model: 'gpt-4o' } },
        ]);
        const compressed = `${plain}.zst`;
        writeFileSync(compressed, execFileSync('zstd', ['-q', '-c', plain]));
        rmSync(plain);
        assert.deepEqual(exportHistory('codex', directory).document.events, [
            { time: start, model: 'openai/gpt-4o', kind: 'session' },
        ]);

        writeHistory(plain, [
            { timestamp: timestamp(0), type: 'session_meta', payload: { id: 'private-old-id', timestamp: timestamp(0), source: 'cli' } },
            { timestamp: timestamp(1000), type: 'turn_context', payload: { model: 'gpt-5' } },
        ]);
        assert.deepEqual(exportHistory('codex', directory).document.events, [
            { time: start, model: 'openai/gpt-5', kind: 'session' },
        ]);

        rmSync(plain);
        const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
        const missing = spawnSync(python, [script, 'codex', directory], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
        assert.notEqual(missing.status, 0);
        assert.equal(missing.stdout, '');
        assert.match(missing.stderr, /requires zstd/i);
        assert.doesNotMatch(missing.stderr, /private|rollout-old/i);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('model observations are ordered by recorded time, even when rollout lines are not', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-order-'));
    try {
        const file = join(directory, 'rollout-sorted.jsonl');
        writeHistory(file, [
            { timestamp: timestamp(0), type: 'session_meta', payload: { id: 'private-session', timestamp: timestamp(0), source: 'cli' } },
            { timestamp: timestamp(4000), type: 'turn_context', payload: { model: 'gpt-5' } },
            { timestamp: timestamp(1000), type: 'turn_context', payload: { model: 'gpt-5' } },
            { timestamp: timestamp(3000), type: 'turn_context', payload: { model: 'gpt-5-codex' } },
        ]);
        assert.deepEqual(exportHistory('codex', file).document.events, [
            { time: start, model: 'openai/gpt-5', kind: 'session' },
            { time: start + 3000, model: 'openai/gpt-5-codex', kind: 'switch', fromModel: 'openai/gpt-5', fromTime: start },
            { time: start + 4000, model: 'openai/gpt-5', kind: 'switch', fromModel: 'openai/gpt-5-codex', fromTime: start + 3000 },
        ]);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('a live partial final record is ignored, but a malformed complete record aborts export', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-partial-'));
    try {
        const file = join(directory, 'rollout-partial.jsonl');
        writeHistory(file, [
            { timestamp: timestamp(0), type: 'session_meta', payload: { id: 'private-session', timestamp: timestamp(0), source: 'cli' } },
            { timestamp: timestamp(1000), type: 'turn_context', payload: { model: 'gpt-5' } },
        ]);
        appendFileSync(file, '{"type":"turn_context","payload":{"model":"private');
        assert.deepEqual(exportHistory('codex', file).document.events, [
            { time: start, model: 'openai/gpt-5', kind: 'session' },
        ]);
        appendFileSync(file, '\n');
        const invalid = spawnSync('python3', [script, 'codex', file], { encoding: 'utf8' });
        assert.notEqual(invalid.status, 0);
        assert.equal(invalid.stdout, '');
        assert.match(invalid.stderr, /Could not export model metadata/);
        assert.doesNotMatch(invalid.stderr, /private|rollout-partial/i);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('export fails without model observations and never follows a supplied history symlink', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tides-invalid-'));
    try {
        const file = join(directory, 'session.jsonl');
        writeHistory(file, [{ type: 'user', timestamp: timestamp(0), message: { content: 'private prompt' } }]);
        const empty = spawnSync('python3', [script, 'claude-code', file], { encoding: 'utf8' });
        assert.notEqual(empty.status, 0);
        assert.equal(empty.stdout, '');
        assert.match(empty.stderr, /Could not export model metadata/);
        assert.doesNotMatch(empty.stderr, /private|session.jsonl|prompt/i);

        const link = join(directory, 'linked.jsonl');
        symlinkSync(file, link);
        const linked = spawnSync('python3', [script, 'claude-code', link], { encoding: 'utf8' });
        assert.notEqual(linked.status, 0);
        assert.equal(linked.stdout, '');
        assert.match(linked.stderr, /Could not export model metadata/);
        assert.doesNotMatch(linked.stderr, /private|session.jsonl|prompt/i);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
