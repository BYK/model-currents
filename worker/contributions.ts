import { brotliDecompressSync } from 'node:zlib';
import { FUTURE_MARGIN_MS, MAX_CELLS, MAX_MODEL_COUNT, MAX_WEEKS, MIN_WEEK_TIME, WEEKLY_FORMAT, WEEKLY_VERSION, validWeeklyModel, weekStart, type WeeklySnapshot } from '../src/weekly-snapshot.ts';

export interface Statement {
    bind(...values: (string | number)[]): Statement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number } }>;
}

export interface Database {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
}

export interface UploadLimit {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

const compressedLimit = 64 * 1024;
const expandedLimit = 512 * 1024;
const contributionId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tokenPattern = /^Bearer ([A-Za-z0-9_-]{43})$/;
const weekPattern = /^\d{4}-\d{2}-\d{2}$/;

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

export function parseSnapshot(input: unknown): WeeklySnapshot {
    if (!exactKeys(input, ['format', 'version', 'weeks']) || input.format !== WEEKLY_FORMAT ||
        input.version !== WEEKLY_VERSION || !Array.isArray(input.weeks) ||
        input.weeks.length < 1 || input.weeks.length > MAX_WEEKS) {
        throw new TypeError('Invalid weekly snapshot.');
    }
    const seen = new Set<string>();
    const weeks: { week: string; models: Record<string, number> }[] = [];
    const latest = Date.now() + FUTURE_MARGIN_MS;
    const cells = input.weeks.reduce<number>((total, item: unknown) => {
        if (!exactKeys(item, ['week', 'models']) || typeof item.week !== 'string' ||
            !weekPattern.test(item.week) || seen.has(item.week) || !item.models ||
            typeof item.models !== 'object' || Array.isArray(item.models)) {
            throw new TypeError('Invalid weekly snapshot.');
        }
        const date = Date.parse(`${item.week}T00:00:00Z`);
        if (!Number.isFinite(date) || date < MIN_WEEK_TIME || date > latest ||
            weekStart(date) !== item.week) {
            throw new TypeError('Invalid weekly snapshot.');
        }
        const entries = Object.entries(item.models);
        if (entries.length > MAX_CELLS || entries.some(([model, count]) =>
            !validWeeklyModel(model) || !Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > MAX_MODEL_COUNT)) {
            throw new TypeError('Invalid weekly snapshot.');
        }
        seen.add(item.week);
        weeks.push({ week: item.week, models: Object.fromEntries(entries) });
        return total + entries.length;
    }, 0);
    if (cells < 1 || cells > MAX_CELLS) throw new TypeError('Invalid weekly snapshot.');
    return { format: WEEKLY_FORMAT, version: WEEKLY_VERSION, weeks };
}

function uuidv7(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const time = Date.now();
    for (const index of [0, 1, 2, 3, 4, 5]) bytes[index] = Math.floor(time / 256 ** (5 - index)) & 255;
    bytes[6] = 0x70 | (bytes[6] & 0x0f);
    bytes[8] = 0x80 | (bytes[8] & 0x3f);
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function newToken(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

async function tokenHash(token: string): Promise<string> {
    return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('hex');
}

function uploadHeaders(request: Request): Response | null {
    if (request.headers.get('Content-Type') !== 'application/vnd.model-tides.weekly+json' ||
        request.headers.get('Content-Encoding') !== 'br' ||
        request.headers.get('X-Model-Tides-Schema') !== 'weekly-v1') {
        return response({ error: 'Expected a Brotli-compressed weekly-v1 snapshot.' }, 415);
    }
    const length = request.headers.get('Content-Length');
    if (length !== null && (!/^[1-9]\d*$/.test(length) || Number(length) > compressedLimit)) {
        return response({ error: 'Upload exceeds the compressed size limit.' }, 413);
    }
    return null;
}

async function readSnapshot(request: Request): Promise<WeeklySnapshot | Response> {
    const length = request.headers.get('Content-Length');
    if (!request.body) return response({ error: 'Empty upload.' }, 400);
    const reader = request.body.getReader();
    const parts: Uint8Array[] = [];
    const size = await (async () => {
        const total = { value: 0 };
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total.value += value.byteLength;
            if (total.value > compressedLimit) {
                await reader.cancel();
                return -1;
            }
            parts.push(value);
        }
        return total.value;
    })();
    if (size < 0) return response({ error: 'Upload exceeds the compressed size limit.' }, 413);
    if (size === 0 || (length !== null && Number(length) !== size)) return response({ error: 'Invalid upload length.' }, 400);
    try {
        const buffer = Buffer.concat(parts, size);
        const bytes = brotliDecompressSync(buffer, { maxOutputLength: expandedLimit });
        return parseSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch {
        return response({ error: 'Invalid compressed weekly snapshot.' }, 400);
    }
}

function rows(snapshot: WeeklySnapshot): { week: string; model: string; count: number }[] {
    return snapshot.weeks.flatMap(({ week, models }) =>
        Object.entries(models).map(([model, count]) => ({ week, model, count })));
}

function insertRows(db: Database, id: string, entries: ReturnType<typeof rows>, hash?: string): Statement[] {
    const statements: Statement[] = [];
    for (let start = 0; start < entries.length; start += 50) {
        const slice = entries.slice(start, start + 50);
        const values = slice.flatMap((entry) => [entry.week, entry.model, entry.count]);
        if (hash) {
            const sql = `WITH input(week, model, count) AS (VALUES ${slice.map(() => '(?, ?, ?)').join(', ')})
                INSERT INTO weekly_counts (contributor_id, week, model, count)
                SELECT ?, week, model, count FROM input WHERE EXISTS
                (SELECT 1 FROM contributors WHERE id = ? AND token_hash = ?)`;
            statements.push(db.prepare(sql).bind(...values, id, id, hash));
        } else {
            const sql = `INSERT INTO weekly_counts (contributor_id, week, model, count) VALUES ${slice.map(() => '(?, ?, ?, ?)').join(', ')}`;
            statements.push(db.prepare(sql).bind(...slice.flatMap((entry) => [id, entry.week, entry.model, entry.count])));
        }
    }
    return statements;
}

function bearer(request: Request): string | null {
    return tokenPattern.exec(request.headers.get('Authorization') ?? '')?.[1] ?? null;
}

export async function getAggregate(db: Database): Promise<{
    weeks: { week: string; model: string; count: number; contributors: number }[];
    truncated: boolean;
}> {
    const { results } = await db.prepare(`SELECT week, model, SUM(count) AS count, COUNT(*) AS contributors
        FROM weekly_counts GROUP BY week, model HAVING COUNT(*) >= 5 ORDER BY week, model LIMIT 3001`).all<{
        week: string; model: string; count: number; contributors: number;
    }>();
    return { weeks: results.slice(0, 3000), truncated: results.length > 3000 };
}

export async function handleContributions(
    request: Request, db: Database, limit: UploadLimit, path: string,
): Promise<Response> {
    if (path === '/api/aggregate' && request.method === 'GET') {
        return response({ ...await getAggregate(db), note: 'Self-reported; cells with fewer than five contributors are hidden.' });
    }

    const match = /^\/api\/contributions\/([^/]+)(\/(?:rotate|share|unshare))?$/.exec(path);
    if (path !== '/api/contributions' && !match) return response({ error: 'Not found.' }, 404);
    const id = match?.[1];
    if (id && !contributionId.test(id)) return response({ error: 'Not found.' }, 404);
    if (match && !match[2] && request.method === 'GET') {
        const authorization = request.headers.get('Authorization');
        const token = bearer(request);
        if (authorization !== null && !token) return response({ error: 'Private token required.' }, 401);
        const access = token ? 'c.token_hash = ?' : 'c.published = 1';
        const { results } = await db.prepare(`SELECT w.week, w.model, w.count, c.published
            FROM contributors c JOIN weekly_counts w ON w.contributor_id = c.id
            WHERE c.id = ? AND ${access} ORDER BY w.week, w.model`)
            .bind(id!, ...(token ? [await tokenHash(token)] : [])).all<{ week: string; model: string; count: number; published: number }>();
        if (!results.length) return response({ error: 'Not found.' }, 404);
        return response({ id, counts: results.map(({ week, model, count }) => ({ week, model, count })), published: results[0].published === 1 });
    }

    const isCreate = path === '/api/contributions' && request.method === 'POST';
    const isReplace = !!id && !match?.[2] && request.method === 'PUT';
    const isDelete = !!id && !match?.[2] && request.method === 'DELETE';
    const isRotate = !!id && match?.[2] === '/rotate' && request.method === 'POST';
    const isShare = !!id && match?.[2] === '/share' && request.method === 'POST';
    const isUnshare = !!id && match?.[2] === '/unshare' && request.method === 'POST';
    if (!isCreate && !isReplace && !isDelete && !isRotate && !isShare && !isUnshare) {
        return response({ error: 'Method not allowed.' }, 405);
    }

    const token = isCreate ? null : bearer(request);
    if (!isCreate && !token) return response({ error: 'Private token required.' }, 401);
    if (isCreate || isReplace) {
        const invalidHeaders = uploadHeaders(request);
        if (invalidHeaders) return invalidHeaders;
    }
    if (isCreate && request.headers.get('X-Model-Tides-Report') !== 'private-v1') {
        return response({ error: 'Update Model Tides before uploading a private contribution.' }, 426);
    }
    const rate = await limit.limit({ key: `write:${request.headers.get('CF-Connecting-IP') ?? 'unattributed'}` });
    if (!rate.success) return response({ error: 'Too many uploads. Try again later.' }, 429);
    const hash = token ? await tokenHash(token) : null;
    if (!isCreate) {
        const authenticated = await db.prepare('SELECT id FROM contributors WHERE id = ? AND token_hash = ?')
            .bind(id!, hash!).first<{ id: string }>();
        if (!authenticated) return response({ error: 'Invalid contribution or token.' }, 401);
        const ownerRate = await limit.limit({ key: `owner:${id}` });
        if (!ownerRate.success) return response({ error: 'Too many uploads. Try again later.' }, 429);
    }
    const now = Date.now();
    if (isDelete) {
        const result = await db.prepare('DELETE FROM contributors WHERE id = ? AND token_hash = ?').bind(id!, hash!).run();
        return result.meta.changes > 0 ? response({ deleted: true }) : response({ error: 'Invalid contribution or token.' }, 401);
    }
    if (isRotate) {
        const replacement = newToken();
        const result = await db.prepare('UPDATE contributors SET token_hash = ?, updated_at = ? WHERE id = ? AND token_hash = ?')
            .bind(await tokenHash(replacement), now, id!, hash!).run();
        return result.meta.changes === 1 ? response({ id, token: replacement }) : response({ error: 'Invalid contribution or token.' }, 401);
    }
    if (isShare || isUnshare) {
        const published = isShare ? 1 : 0;
        const result = await db.prepare('UPDATE contributors SET published = ?, updated_at = ? WHERE id = ? AND token_hash = ?')
            .bind(published, now, id!, hash!).run();
        if (result.meta.changes !== 1) return response({ error: 'Invalid contribution or token.' }, 401);
        return response({ id, published: isShare, ...(isShare ? { url: `${new URL(request.url).origin}/u/${id}` } : {}) });
    }
    const snapshot = await readSnapshot(request);
    if (snapshot instanceof Response) return snapshot;
    const entries = rows(snapshot);
    if (isCreate) {
        const createdId = uuidv7();
        const secret = newToken();
        await db.batch([
            db.prepare('INSERT INTO contributors (id, token_hash, created_at, updated_at, published) VALUES (?, ?, ?, ?, 0)')
                .bind(createdId, await tokenHash(secret), now, now),
            ...insertRows(db, createdId, entries),
        ]);
        return response({ id: createdId, published: false, token: secret }, 201);
    }
    const weeks = snapshot.weeks.map(({ week }) => week);
    const result = await db.batch([
        db.prepare('UPDATE contributors SET updated_at = ? WHERE id = ? AND token_hash = ?').bind(now, id!, hash!),
        db.prepare(`DELETE FROM weekly_counts WHERE contributor_id = ? AND week IN (${weeks.map(() => '?').join(', ')})
            AND EXISTS (SELECT 1 FROM contributors WHERE id = ? AND token_hash = ?)`)
            .bind(id!, ...weeks, id!, hash!),
        ...insertRows(db, id!, entries, hash!),
    ]);
    if (result[0].meta.changes !== 1) return response({ error: 'Invalid contribution or token.' }, 401);
    const current = await db.prepare('SELECT published FROM contributors WHERE id = ? AND token_hash = ?')
        .bind(id!, hash!).first<{ published: number }>();
    return current ? response({ id, replacedWeeks: weeks.length, published: current.published === 1 }) :
        response({ error: 'Invalid contribution or token.' }, 401);
}
