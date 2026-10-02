import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { brotliCompressSync } from 'node:zlib';
import { handleContributions as handleRealContributions, parseSnapshot } from '../worker/contributions.ts';
import { getReport } from '../worker/public-pages.ts';
import worker from '../worker/index.ts';
import { buildWeeklySnapshot } from '../src/weekly-snapshot.ts';

function database() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(readFileSync(new URL('../migrations/0001_contributions.sql', import.meta.url), 'utf8'));
    sqlite.exec(readFileSync(new URL('../migrations/0002_private_contributions.sql', import.meta.url), 'utf8'));
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
const handleContributions = handleRealContributions;

function upload(data, pathname = '/api/contributions/private', method = 'POST', token, visibility = 'private') {
    const bytes = brotliCompressSync(Buffer.from(JSON.stringify(data)));
    return new Request(`https://modeltides.dev${pathname}`, {
        method, body: bytes,
        headers: {
            'Content-Type': 'application/vnd.model-tides.weekly+json',
            'Content-Encoding': 'br',
            'X-Model-Tides-Schema': 'weekly-v1',
            'X-Model-Tides-Report': 'private-v1',
            ...(method === 'PUT' ? { 'X-Model-Tides-Expected-Visibility': visibility } : {}),
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

test('new private creation uses a path the old Worker cannot treat as a public contribution', async () => {
    const db = database();
    try {
        const path = '/api/contributions/private';
        const env = { DB: db, UPLOAD_LIMIT: limit, ASSETS: { async fetch() { return new Response('asset'); } } };
        const created = await worker.fetch(upload(snapshot(), path), env);
        assert.equal(created.status, 201);
        const { id, token, published } = await created.json();
        assert.equal(published, false);
        assert.equal((await db.prepare('SELECT published FROM contributors WHERE id = ?').bind(id).first()).published, 0);
        assert.equal((await worker.fetch(new Request(`https://modeltides.dev/u/${id}`), env)).status, 404);
        assert.equal((await worker.fetch(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }), env)).status, 200);
        const oldPath = await worker.fetch(upload(snapshot(), '/api/contributions'), env);
        assert.equal(oldPath.status, 426, 'old clients must not create contributions at the unversioned path');
        assert.equal((await db.prepare('SELECT count(*) AS count FROM contributors').first()).count, 1);
    } finally { db.close(); }
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

test('reviewed historical and route-specific model IDs can be shared without a registry request', async () => {
    const db = database();
    try {
        const historical = { ...snapshot(), weeks: [{ week: '2026-09-28', models: {
            'anthropic/claude-3-5-haiku-latest': 1, 'github-copilot/claude-opus-4.5': 2,
            'openrouter/inclusionai/ling-3.0-flash-vl:free': 3, 'xai/grok-4-fast': 4,
        } }] };
        const created = await handleContributions(upload(historical), db, limit, '/api/contributions/private');
        assert.equal(created.status, 201);
        const { id, token } = await created.json();
        const path = `/api/contributions/${id}`;
        const replace = await handleContributions(upload(historical, path, 'PUT', token),
            db, limit, `/api/contributions/${id}`);
        assert.equal(replace.status, 200);
        const after = await handleContributions(new Request(`https://modeltides.dev${path}`, {
            headers: { Authorization: `Bearer ${token}` },
        }), db, limit, path);
        assert.deepEqual((await after.json()).counts, Object.entries(historical.weeks[0].models).sort(([a], [b]) => a.localeCompare(b))
            .map(([model, count]) => ({ week: '2026-09-28', model, count })));
        assert.equal((await handleContributions(new Request('https://modeltides.dev/api/models'), db, limit, '/api/models')).status, 404);
    } finally { db.close(); }
});

test('Brotli upload saves a private contribution; replacing weeks does not add duplicate counts', async () => {
    const db = database();
    try {
        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions/private');
        assert.equal(created.status, 201);
        const { id, url, token } = await created.json();
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
        assert.equal(url, undefined);
        assert.equal(token.length, 43);

        const personal = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }), db, limit, `/api/contributions/${id}`);
        assert.deepEqual((await personal.json()).counts, [{ week: '2026-09-28', model: 'anthropic/claude-sonnet', count: 2 }]);

        const replaced = await handleContributions(upload(snapshot(3), `/api/contributions/${id}`, 'PUT', token), db, limit, `/api/contributions/${id}`);
        assert.equal(replaced.status, 200);
        const retry = await handleContributions(upload(snapshot(3), `/api/contributions/${id}`, 'PUT', token), db, limit, `/api/contributions/${id}`);
        assert.equal(retry.status, 200);
        const after = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }), db, limit, `/api/contributions/${id}`);
        assert.equal((await after.json()).counts[0].count, 3);

        const badToken = 'A'.repeat(43);
        const denied = await handleContributions(upload(snapshot(9), `/api/contributions/${id}`, 'PUT', badToken), db, limit, `/api/contributions/${id}`);
        assert.equal(denied.status, 401);
        const still = await handleContributions(new Request(`https://modeltides.dev/api/contributions/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }), db, limit, `/api/contributions/${id}`);
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

test('new uploads count toward the aggregate without exposing a personal report until the owner shares', async () => {
    const db = database();
    try {
        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions/private');
        assert.equal(created.status, 201);
        const { id, token, published, url } = await created.json();
        assert.equal(published, false);
        assert.equal(url, undefined);
        const path = `/api/contributions/${id}`;
        const env = { DB: db, UPLOAD_LIMIT: limit, ASSETS: { async fetch() { return new Response('asset'); } } };
        const read = (pathname, auth, method = 'GET') => worker.fetch(new Request(`https://modeltides.dev${pathname}`, {
            method, headers: auth ? { Authorization: `Bearer ${auth}` } : {},
        }), env);
        assert.equal((await read(path)).status, 404);
        assert.equal((await read(`/u/${id}`)).status, 404);
        assert.equal((await read(`/og/${id}.png`, null)).status, 404);
        assert.deepEqual((await (await read(path, token)).json()).counts,
            [{ week: '2026-09-28', model: 'anthropic/claude-sonnet', count: 2 }]);
        assert.equal((await read(path, 'A'.repeat(43))).status, 404);
        assert.equal(await getReport(db, id), null);

        const sharePath = `${path}/share`;
        assert.equal((await worker.fetch(new Request(`https://modeltides.dev${sharePath}`, { method: 'POST' }), env)).status, 401);
        assert.equal((await worker.fetch(new Request(`https://modeltides.dev${sharePath}`, {
            method: 'POST', headers: { Authorization: `Bearer ${'A'.repeat(43)}` },
        }), env)).status, 401);
        const share = () => worker.fetch(new Request(`https://modeltides.dev${sharePath}`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }), env);
        assert.deepEqual(await (await share()).json(), { id, published: true, url: `https://modeltides.dev/u/${id}` });
        assert.equal((await share()).status, 200, 'sharing is idempotent');
        assert.equal((await read(path)).status, 200);
        assert.equal((await read(path, 'A'.repeat(43))).status, 404, 'a public report never validates an invalid private key');
        assert.equal((await read(`/u/${id}`)).status, 200);
        assert.equal((await read(`/og/${id}.png`, null, 'HEAD')).status, 200);
        const replacedWhileShared = await handleContributions(upload(snapshot(3), path, 'PUT', token, 'public'), db, limit, path);
        assert.equal((await replacedWhileShared.json()).published, true);
        assert.equal((await getReport(db, id)).total, 3);

        const hidePath = `${path}/unshare`;
        const hide = () => worker.fetch(new Request(`https://modeltides.dev${hidePath}`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }), env);
        assert.deepEqual(await (await hide()).json(), { id, published: false });
        assert.equal((await hide()).status, 200, 'hiding is idempotent');
        assert.equal((await read(path)).status, 404);
        assert.equal((await read(`/u/${id}`)).status, 404);
        assert.equal((await read(`/og/${id}.png`)).status, 404);
        assert.equal((await read(path, token)).status, 200);
        const replacedWhilePrivate = await handleContributions(upload(snapshot(4), path, 'PUT', token), db, limit, path);
        assert.equal((await replacedWhilePrivate.json()).published, false);
        assert.equal((await read(path)).status, 404);
        assert.equal(await getReport(db, id), null);
    } finally { db.close(); }
});

test('replacement refuses to publish counts if another owner session shared the report after preview', async () => {
    const db = database();
    try {
        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions/private');
        const { id, token } = await created.json();
        const path = `/api/contributions/${id}`;
        const sharePath = `${path}/share`;
        assert.equal((await handleContributions(new Request(`https://modeltides.dev${sharePath}`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
        }), db, limit, sharePath)).status, 200);
        const outdated = await handleContributions(upload(snapshot(9), path, 'PUT', token, 'private'), db, limit, path);
        assert.equal(outdated.status, 409);
        assert.equal((await getReport(db, id)).total, 2, 'mismatched visibility never writes the reviewed counts');
        const reviewed = await handleContributions(upload(snapshot(9), path, 'PUT', token, 'public'), db, limit, path);
        assert.equal(reviewed.status, 200);
        assert.equal((await getReport(db, id)).total, 9);
    } finally { db.close(); }
});

test('existing links remain public when the publication migration is applied', async () => {
    const db = database();
    try {
        const id = '0199abcf-22aa-7333-8abc-0123456789ab';
        await db.prepare('INSERT INTO contributors (id, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?)')
            .bind(id, 'previously-published', 1, 1).run();
        await db.prepare('INSERT INTO weekly_counts (contributor_id, week, model, count) VALUES (?, ?, ?, ?)')
            .bind(id, '2026-09-28', 'openai/gpt-5', 1).run();
        assert.equal((await getReport(db, id)).total, 1);
    } finally { db.close(); }
});

test('aggregate hides sparse cells and reports self-reported counts only with five contributors', async () => {
    const db = database();
    try {
        const aggregate = () => handleContributions(new Request('https://modeltides.dev/api/aggregate'), db, limit, '/api/aggregate');
        const ids = [];
        for (const _index of [1, 2, 3, 4]) {
            const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions/private');
            ids.push(await created.json());
        }
        assert.deepEqual((await (await aggregate()).json()).weeks, []);
        const fifth = await handleContributions(upload(snapshot(7)), db, limit, '/api/contributions/private');
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
        const oldClient = upload(snapshot(), '/api/contributions');
        oldClient.headers.delete('X-Model-Tides-Report');
        assert.equal((await handleContributions(oldClient, db, rejectLimit, '/api/contributions')).status, 426);
        assert.equal((await handleContributions(upload(snapshot(), '/api/contributions'), db, rejectLimit,
            '/api/contributions')).status, 426, 'the old path cannot create even with the new header');
        assert.equal(called, 0);
        assert.equal((await db.prepare('SELECT count(*) AS count FROM contributors').first()).count, 0);
        assert.equal((await handleContributions(upload(snapshot()), db, rejectLimit, '/api/contributions/private')).status, 429);
        assert.equal(called, 1);
        const tooLarge = new Request('https://modeltides.dev/api/contributions/private', {
            method: 'POST', body: 'private transcript',
            headers: {
                'Content-Type': 'application/vnd.model-tides.weekly+json',
                'Content-Encoding': 'br', 'X-Model-Tides-Schema': 'weekly-v1',
                'Content-Length': '65537',
            },
        });
        assert.equal((await handleContributions(tooLarge, db, limit, '/api/contributions/private')).status, 413);
        const expanded = { ...snapshot(), note: 'x'.repeat(600_000) };
        assert.equal((await handleContributions(upload(expanded), db, limit, '/api/contributions/private')).status, 400);
        const created = await handleContributions(upload(snapshot()), db, limit, '/api/contributions/private');
        const { id, token } = await created.json();
        const olderReplace = upload(snapshot(4), `/api/contributions/${id}`, 'PUT', token);
        olderReplace.headers.delete('X-Model-Tides-Expected-Visibility');
        assert.equal((await handleContributions(olderReplace, db, rejectLimit,
            `/api/contributions/${id}`)).status, 426);
        assert.equal(called, 1, 'an old client cannot replace without an explicit visibility check');
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
