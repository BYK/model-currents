import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { brotliCompressSync } from 'node:zlib';
import { handleContributions as handleRealContributions, parseSnapshot } from '../worker/contributions.ts';
import { buildWeeklySnapshot, fetchKnownModels, filterWeeklySnapshot } from '../src/weekly-snapshot.ts';

function database() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(readFileSync(new URL('../migrations/0001_contributions.sql', import.meta.url), 'utf8'));
    const prepare = (sql) => {
        const statement = {
            values: [],
            bind(...values) { this.values = values; return this; },
            first() { return Promise.resolve(sqlite.prepare(sql).get(...this.values) ?? null); },
            all() { return Promise.resolve({ results: sqlite.prepare(sql).all(...this.values) }); },
            run() {
                // D1 includes rows removed by ON DELETE CASCADE in meta.changes.
                const cascaded = sql.startsWith('DELETE FROM contributors')
                    ? sqlite.prepare('SELECT count(*) AS count FROM weekly_counts WHERE contributor_id = ?').get(this.values[0]).count
                    : 0;
                const changes = Number(sqlite.prepare(sql).run(...this.values).changes);
                return Promise.resolve({ meta: { changes: changes + (changes ? cascaded : 0) } });
            },
        };
        return statement;
    };
    return {
        prepare,
        async batch(statements) {
            sqlite.exec('BEGIN');
            try {
                const result = [];
                for (const statement of statements) result.push(await statement.run());
                sqlite.exec('COMMIT');
                return result;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        },
        close() { sqlite.close(); },
    };
}

const day = Date.UTC(2026, 8, 28);
const snapshot = (count = 2) => ({
    format: 'model-tides-weekly', version: 1,
    weeks: [{ week: '2026-09-28', models: { 'anthropic/claude-sonnet': count } }],
});
const limit = { async limit() { return { success: true }; } };
const knownModels = new Set(['anthropic/claude-sonnet', 'openai/gpt-5']);
const handleContributions = (request, db, throttle, path) =>
    handleRealContributions(request, db, throttle, path, async () => knownModels);

function upload(data, pathname = '/api/contributions', method = 'POST', token) {
    const bytes = brotliCompressSync(Buffer.from(JSON.stringify(data)));
    return new Request(`https://modeltides.dev${pathname}`, {
        method, body: bytes,
        headers: {
            'Content-Type': 'application/vnd.model-tides.weekly+json',
            'Content-Encoding': 'br',
            'X-Model-Tides-Schema': 'weekly-v1',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}

test('weekly snapshot copies only week, model, and event count', () => {
    const input = [
        { time: day, model: 'anthropic/claude-sonnet', kind: 'session', sessionId: 'private-one', text: 'private prompt' },
        { time: day + 86_400_000, model: 'anthropic/claude-sonnet', kind: 'switch', fromModel: 'openai/gpt-5', fromTime: day, sessionId: 'private-two' },
    ];
    assert.deepEqual(buildWeeklySnapshot(input), snapshot());
    const wire = JSON.stringify(buildWeeklySnapshot(input));
    for (const privateValue of ['sessionId', 'private-one', 'private-two', 'text', 'private prompt', 'fromModel', 'fromTime']) {
        assert.equal(wire.includes(privateValue), false);
    }
});

test('local preview rejects dates the upload endpoint cannot accept', () => {
    assert.throws(() => buildWeeklySnapshot([
        { time: Date.UTC(2100, 0, 1), model: 'openai/gpt-5' },
    ]), RangeError);
    const emoji = { ...snapshot(), weeks: [{ week: '2026-09-28', models: { 'custom/🦄': 1 } }] };
    assert.deepEqual(parseSnapshot(emoji), emoji);
    assert.throws(() => buildWeeklySnapshot([{ time: day, model: 'custom/\ud800' }]), TypeError);
});

test('reject unsupported schemas, extra fields, bad weeks, excessive counts, and private fields', () => {
    const valid = snapshot();
    assert.deepEqual(parseSnapshot(valid), valid);
    for (const invalid of [
        { ...valid, sessionId: 'private' },
        { ...valid, version: 2 },
        { ...valid, weeks: [{ week: '2026-09-27', models: { ok: 1 } }] },
        { ...valid, weeks: [{ week: '2026-09-28', models: { ok: 10_001 } }] },
        { ...valid, weeks: [{ week: '2026-09-28', models: { ok: 1 }, transcript: 'private' }] },
        { ...valid, weeks: [...valid.weeks, ...valid.weeks] },
    ]) assert.throws(() => parseSnapshot(invalid), TypeError);
});

test('only listed model names enter the reviewed snapshot; unlisted names remain local', () => {
    const input = { ...snapshot(), weeks: [{ week: '2026-09-28', models: {
        'anthropic/claude-sonnet': 2, 'openai/gpt-5': 1, 'custom/fake-model': 3,
    } }] };
    const { snapshot: reviewed, excluded } = filterWeeklySnapshot(input, knownModels);
    assert.deepEqual(reviewed.weeks, [{ week: '2026-09-28', models: {
        'anthropic/claude-sonnet': 2, 'openai/gpt-5': 1,
    } }]);
    assert.deepEqual(excluded, ['custom/fake-model']);
    const allUnlisted = filterWeeklySnapshot({ ...snapshot(), weeks: [{
        week: '2026-09-28', models: { 'custom/fake-model': 3 },
    }] }, knownModels);
    assert.deepEqual(allUnlisted.snapshot.weeks, []);
    assert.deepEqual(allUnlisted.excluded, ['custom/fake-model']);
});

test('the preview fetches the public registry without sending local model names', async () => {
    const requests = [];
    const known = await fetchKnownModels('/api/models', async (url, options) => {
        requests.push({ url, options });
        return Response.json({ models: ['openai/gpt-5', 'anthropic/claude-sonnet'] });
    });
    assert.equal(known.has('openai/gpt-5'), true);
    assert.deepEqual(requests, [{ url: '/api/models', options: { cache: 'no-store' } }]);
    await assert.rejects(fetchKnownModels('/api/models', async () => Response.json({
        models: ['openai/gpt-5', 'openai/gpt-5'],
    })), /Invalid model registry/);
});

test('direct writes reject unlisted models and registry outages before changing counts', async () => {
    const db = database();
    try {
        const unknown = { ...snapshot(), weeks: [{ week: '2026-09-28', models: {
            'anthropic/claude-sonnet': 1, 'custom/fake-model': 1,
        } }] };
        const create = await handleContributions(upload(unknown), db, limit, '/api/contributions');
        assert.equal(create.status, 422);
        assert.equal((await db.prepare('SELECT count(*) AS count FROM contributors').first()).count, 0);
        const unavailable = await handleRealContributions(upload(snapshot()), db, limit, '/api/contributions',
            async () => { throw new Error('upstream error with private details'); });
        assert.equal(unavailable.status, 503);
        assert.equal(JSON.stringify(await unavailable.json()).includes('private details'), false);
        const listed = await handleContributions(new Request('https://modeltides.dev/api/models'), db, limit, '/api/models');
        assert.equal(listed.status, 200);
        assert.deepEqual((await listed.json()).models, [...knownModels].sort());

        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions');
        const { id, token } = await created.json();
        const replace = await handleContributions(upload(unknown, `/api/contributions/${id}`, 'PUT', token),
            db, limit, `/api/contributions/${id}`);
        assert.equal(replace.status, 422);
        const after = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`),
            db, limit, `/api/contributions/${id}`);
        assert.deepEqual((await after.json()).counts, [{ week: '2026-09-28', model: 'anthropic/claude-sonnet', count: 2 }]);
    } finally { db.close(); }
});

test('Brotli upload creates a public link; replacing weeks does not add duplicate counts', async () => {
    const db = database();
    try {
        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions');
        assert.equal(created.status, 201);
        const { id, url, token } = await created.json();
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
        assert.equal(url, `https://modeltides.dev/u/${id}`);
        assert.equal(token.length, 43);

        const personal = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`), db, limit, `/api/contributions/${id}`);
        assert.deepEqual((await personal.json()).counts, [{ week: '2026-09-28', model: 'anthropic/claude-sonnet', count: 2 }]);

        const replaced = await handleContributions(upload(snapshot(3), `/api/contributions/${id}`, 'PUT', token), db, limit, `/api/contributions/${id}`);
        assert.equal(replaced.status, 200);
        const retry = await handleContributions(upload(snapshot(3), `/api/contributions/${id}`, 'PUT', token), db, limit, `/api/contributions/${id}`);
        assert.equal(retry.status, 200);
        const after = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`), db, limit, `/api/contributions/${id}`);
        assert.equal((await after.json()).counts[0].count, 3);

        const badToken = 'A'.repeat(43);
        const denied = await handleContributions(upload(snapshot(9), `/api/contributions/${id}`, 'PUT', badToken), db, limit, `/api/contributions/${id}`);
        assert.equal(denied.status, 401);
        const still = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`), db, limit, `/api/contributions/${id}`);
        assert.equal((await still.json()).counts[0].count, 3);

        const rotatePath = `/api/contributions/${id}/rotate`;
        const rotated = await handleContributions(new Request(`https://modeltides.dev${rotatePath}`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }), db, limit, rotatePath);
        const newToken = (await rotated.json()).token;
        assert.equal(rotated.status, 200);
        assert.notEqual(newToken, token);
        const deletedWithOld = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        }), db, limit, `/api/contributions/${id}`);
        assert.equal(deletedWithOld.status, 401);
        const deleted = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${newToken}` },
        }), db, limit, `/api/contributions/${id}`);
        assert.equal(deleted.status, 200);
        const missing = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`), db, limit, `/api/contributions/${id}`);
        assert.equal(missing.status, 404);
    } finally { db.close(); }
});

test('aggregate hides sparse cells and reports self-reported counts only with five contributors', async () => {
    const db = database();
    try {
        const aggregate = () => handleContributions(new Request('https://modeltides.dev/api/aggregate'), db, limit, '/api/aggregate');
        const ids = [];
        for (const _index of [1, 2, 3, 4]) {
            const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions');
            ids.push(await created.json());
        }
        assert.deepEqual((await (await aggregate()).json()).weeks, []);
        const fifth = await handleContributions(upload(snapshot(7)), db, limit, '/api/contributions');
        ids.push(await fifth.json());
        assert.deepEqual((await (await aggregate()).json()).weeks, [{
            week: '2026-09-28', model: 'anthropic/claude-sonnet', count: 15, contributors: 5,
        }]);
        const { id, token } = ids[0];
        await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        }), db, limit, `/api/contributions/${id}`);
        assert.deepEqual((await (await aggregate()).json()).weeks, []);
    } finally { db.close(); }
});

test('headers and rate limit reject invalid uploads before body is read or database written', async () => {
    const db = database();
    try {
        let called = 0;
        const rejectLimit = { async limit() { called++; return { success: false }; } };
        const badType = new Request('https://modeltides.dev/api/contributions', { method: 'POST', body: 'private transcript' });
        assert.equal((await handleContributions(badType, db, rejectLimit, '/api/contributions')).status, 415);
        assert.equal(called, 0);
        assert.equal((await handleContributions(upload(snapshot()), db, rejectLimit, '/api/contributions')).status, 429);
        assert.equal(called, 1);
        const tooLarge = new Request('https://modeltides.dev/api/contributions', {
            method: 'POST', body: 'private transcript',
            headers: {
                'Content-Type': 'application/vnd.model-tides.weekly+json',
                'Content-Encoding': 'br', 'X-Model-Tides-Schema': 'weekly-v1',
                'Content-Length': '65537',
            },
        });
        assert.equal((await handleContributions(tooLarge, db, limit, '/api/contributions')).status, 413);
        const expanded = { ...snapshot(), note: 'x'.repeat(600_000) };
        assert.equal((await handleContributions(upload(expanded), db, limit, '/api/contributions')).status, 400);
        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions');
        const { id } = await created.json();
        const keys = [];
        const record = { async limit({ key }) { keys.push(key); return { success: true }; } };
        const denied = await handleContributions(upload(snapshot(4), `/api/contributions/${id}`, 'PUT', 'A'.repeat(43)),
            db, record, `/api/contributions/${id}`);
        assert.equal(denied.status, 401);
        assert.equal(keys.length, 1, 'invalid credentials never consume the real owner bucket');
        assert.equal(keys[0].startsWith('write:'), true);
        assert.equal((await db.prepare('SELECT count(*) AS count FROM contributors').first()).count, 1);
    } finally { db.close(); }
});
