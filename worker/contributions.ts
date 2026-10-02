import { brotliDecompressSync } from 'node:zlib';
import { MAX_CELLS, MAX_REVIEW_CELLS, MAX_WEEKS, parseSnapshot, type WeeklySnapshot } from '../src/weekly-snapshot.ts';
export { parseSnapshot } from '../src/weekly-snapshot.ts';

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

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
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

function insertRows(db: Database, id: string, entries: ReturnType<typeof rows>, hash?: string, expectedPublished?: number): Statement[] {
    const statements: Statement[] = [];
    for (let start = 0; start < entries.length; start += 50) {
        const slice = entries.slice(start, start + 50);
        const values = slice.flatMap((entry) => [entry.week, entry.model, entry.count]);
        if (hash) {
            if (expectedPublished !== 0 && expectedPublished !== 1) throw new TypeError('Expected report visibility.');
            const sql = `WITH input(week, model, count) AS (VALUES ${slice.map(() => '(?, ?, ?)').join(', ')})
                INSERT INTO weekly_counts (contributor_id, week, model, count)
                SELECT ?, week, model, count FROM input WHERE EXISTS
                (SELECT 1 FROM contributors WHERE id = ? AND token_hash = ? AND published = ?)`;
            statements.push(db.prepare(sql).bind(...values, id, id, hash, expectedPublished));
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

    const privateCreatePath = '/api/contributions/private';
    const match = /^\/api\/contributions\/([^/]+)(\/(?:rotate|share|unshare))?$/.exec(path);
    if (path !== '/api/contributions' && path !== privateCreatePath && !match) return response({ error: 'Not found.' }, 404);
    const id = path === privateCreatePath ? undefined : match?.[1];
    if (id && !contributionId.test(id)) return response({ error: 'Not found.' }, 404);
    if (id && !match?.[2] && request.method === 'GET') {
        const authorization = request.headers.get('Authorization');
        const token = bearer(request);
        if (authorization !== null && !token) return response({ error: 'Private token required.' }, 401);
        const access = token ? 'c.token_hash = ?' : 'c.published = 1';
        const { results } = await db.prepare(`SELECT w.week, w.model, w.count, c.published, c.report_revision
            FROM contributors c JOIN weekly_counts w ON w.contributor_id = c.id
            WHERE c.id = ? AND ${access} ORDER BY w.week, w.model LIMIT ?`)
            .bind(id!, ...(token ? [await tokenHash(token)] : []), MAX_REVIEW_CELLS + 1).all<{
                week: string; model: string; count: number; published: number; report_revision: number;
            }>();
        if (!results.length) return response({ error: 'Not found.' }, 404);
        if (results.length > MAX_REVIEW_CELLS) return token
            ? response({ id, published: results[0].published === 1, revision: results[0].report_revision, tooLarge: true })
            : response({ error: 'Report exceeds the display limit.' }, 413);
        return response({ id, counts: results.map(({ week, model, count }) => ({ week, model, count })),
            published: results[0].published === 1, ...(token ? { revision: results[0].report_revision } : {}) });
    }

    const isCreate = path === privateCreatePath && request.method === 'POST';
    const isLegacyCreate = path === '/api/contributions' && request.method === 'POST';
    const isReplace = !!id && !match?.[2] && request.method === 'PUT';
    const isDelete = !!id && !match?.[2] && request.method === 'DELETE';
    const isRotate = !!id && match?.[2] === '/rotate' && request.method === 'POST';
    const isShare = !!id && match?.[2] === '/share' && request.method === 'POST';
    const isUnshare = !!id && match?.[2] === '/unshare' && request.method === 'POST';
    if (!isCreate && !isLegacyCreate && !isReplace && !isDelete && !isRotate && !isShare && !isUnshare) {
        return response({ error: 'Method not allowed.' }, 405);
    }

    const token = isCreate || isLegacyCreate ? null : bearer(request);
    if (!isCreate && !isLegacyCreate && !token) return response({ error: 'Private token required.' }, 401);
    if (isCreate || isLegacyCreate || isReplace) {
        const invalidHeaders = uploadHeaders(request);
        if (invalidHeaders) return invalidHeaders;
    }
    if (isLegacyCreate || (isCreate && request.headers.get('X-Model-Tides-Report') !== 'private-v1')) {
        return response({ error: 'Update Model Tides before uploading a private contribution.' }, 426);
    }
    const expectedVisibility = isReplace ? request.headers.get('X-Model-Tides-Expected-Visibility') : null;
    if (isReplace && expectedVisibility !== 'private' && expectedVisibility !== 'public') {
        return response({ error: 'Update Model Tides before replacing a contribution.' }, 426);
    }
    const expectedPublished = expectedVisibility === 'public' ? 1 : 0;
    const reviewed = isShare ? request.headers.get('X-Model-Tides-Reviewed-Revision') : null;
    if (isShare && (reviewed === null || !/^(0|[1-9]\d*)$/.test(reviewed) ||
        !Number.isSafeInteger(Number(reviewed)))) {
        return response({ error: 'Update Model Tides and review every weekly count before sharing.' }, 426);
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
        const sql = isShare
            ? 'UPDATE contributors SET published = ?, updated_at = ?, report_revision = report_revision + 1 WHERE id = ? AND token_hash = ? AND report_revision = ?'
            : 'UPDATE contributors SET published = ?, updated_at = ?, report_revision = report_revision + 1 WHERE id = ? AND token_hash = ?';
        const result = await db.prepare(sql).bind(published, now, id!, hash!, ...(isShare ? [Number(reviewed)] : [])).run();
        if (result.meta.changes !== 1) return response({ error: 'Report changed. Review all counts before sharing.' }, 409);
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
    const retained = await db.prepare(`SELECT COUNT(*) AS cells, COUNT(DISTINCT week) AS weeks FROM weekly_counts
        WHERE contributor_id = ? AND week NOT IN (${weeks.map(() => '?').join(', ')})`)
        .bind(id!, ...weeks).first<{ cells: number; weeks: number }>();
    if (!retained || retained.cells + entries.length > MAX_CELLS || retained.weeks + weeks.length > MAX_WEEKS) {
        return response({ error: 'Stored report exceeds the weekly count limit.' }, 413);
    }
    const result = await db.batch([
        db.prepare('UPDATE contributors SET updated_at = ?, report_revision = report_revision + 1 WHERE id = ? AND token_hash = ? AND published = ?')
            .bind(now, id!, hash!, expectedPublished),
        db.prepare(`DELETE FROM weekly_counts WHERE contributor_id = ? AND week IN (${weeks.map(() => '?').join(', ')})
            AND EXISTS (SELECT 1 FROM contributors WHERE id = ? AND token_hash = ? AND published = ?)`)
            .bind(id!, ...weeks, id!, hash!, expectedPublished),
        ...insertRows(db, id!, entries, hash!, expectedPublished),
    ]);
    if (result[0].meta.changes !== 1) return response({ error: 'Report visibility changed. Review before replacing.' }, 409);
    const current = await db.prepare('SELECT published FROM contributors WHERE id = ? AND token_hash = ?')
        .bind(id!, hash!).first<{ published: number }>();
    return current ? response({ id, replacedWeeks: weeks.length, published: current.published === 1 }) :
        response({ error: 'Invalid contribution or token.' }, 401);
}
