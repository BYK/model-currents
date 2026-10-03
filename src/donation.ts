import { parseOwnedReport, parseSnapshot, type OwnedReport, type WeeklySnapshot } from './weekly-snapshot.ts';

const contributionId = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const privateKey = /^[A-Za-z0-9_-]{43}$/;
const endpoint = '/api/contributions';

export async function loadOwnedForDonation(
    id: string, token: string, fetchImpl: typeof fetch = fetch,
): Promise<OwnedReport> {
    if (!contributionId.test(id) || !privateKey.test(token)) throw new TypeError('Enter the private owner key to review your report.');
    const response = await fetchImpl(`${endpoint}/${id}`, { method: 'GET',
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error',
        credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Could not verify the private owner key. Nothing was donated.');
    const report = parseOwnedReport(await response.json(), id);
    if (report.metricVersion !== 2) throw new Error('This earlier report needs active session-day counts. Rescan your local history with the current CLI before donating.');
    if (!report.published || report.inAggregate === null) throw new Error('Report visibility or ownership changed. Nothing was donated.');
    if (report.inAggregate) throw new Error('This report is already in the community chart.');
    if (!report.snapshot) throw new Error('Review of this full report is unavailable. Nothing was donated.');
    return report;
}

export async function donateOwnedReport(
    id: string, token: string, reviewed: Pick<OwnedReport, 'revision' | 'snapshot'>,
    fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; inAggregate: true }> {
    if (!contributionId.test(id) || !privateKey.test(token) || !reviewed.snapshot ||
        !Number.isSafeInteger(reviewed.revision) || reviewed.revision < 0) {
        throw new TypeError('Review the complete report with its private owner key first.');
    }
    if (parseSnapshot(reviewed.snapshot).version !== 2) throw new TypeError('Review active session-day counts first.');
    const response = await fetchImpl(`${endpoint}/${id}/contribute`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Model-Tides-Reviewed-Revision': String(reviewed.revision) },
        cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(response.status === 409 ?
        'The report changed. Review all counts again before donating.' : 'Could not donate this report. Nothing was confirmed.');
    const result: { id?: unknown; inAggregate?: unknown } = await response.json();
    if (result.id !== id || result.inAggregate !== true) throw new Error('Could not confirm donation. Check your report before retrying.');
    return { id, inAggregate: true };
}

export async function donateGistSnapshot(
    input: WeeklySnapshot, fetchImpl: typeof fetch = fetch,
    compress: (bytes: Uint8Array) => Promise<Uint8Array> = async (bytes) => {
        const { default: brotliPromise } = await import('brotli-wasm');
        const brotli = await brotliPromise;
        return brotli.compress(bytes, { quality: 5 });
    },
): Promise<{ id: string; token: string; url: string }> {
    const snapshot = parseSnapshot(input);
    if (snapshot.version !== 2) throw new TypeError('Only active session-day counts can be donated. Rescan local history with the current CLI.');
    const body = await compress(new TextEncoder().encode(JSON.stringify(snapshot)));
    if (body.byteLength > 64 * 1024) throw new RangeError('The weekly counts exceed the donation limit.');
    const response = await fetchImpl(`${endpoint}/donate-v2`, { method: 'POST', body: body as BodyInit,
        headers: { 'Content-Type': 'application/vnd.model-tides.weekly+json', 'Content-Encoding': 'br',
            'X-Model-Tides-Schema': 'weekly-v2', 'X-Model-Tides-Report': 'donated-v2' },
        cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Could not donate the reviewed counts. Nothing was confirmed.');
    const result: { id?: unknown; token?: unknown; url?: unknown; published?: unknown;
        inAggregate?: unknown; metricVersion?: unknown } = await response.json();
    const origin = typeof location === 'undefined' ? 'https://modeltides.dev' : location.origin;
    if (typeof result.id !== 'string' || !contributionId.test(result.id) ||
        typeof result.token !== 'string' || !privateKey.test(result.token) ||
        result.url !== `${origin}/u/${result.id}` || result.published !== true ||
        result.inAggregate !== true || result.metricVersion !== 2) {
        throw new Error('Could not confirm donation. Keep this page open and check before retrying.');
    }
    return { id: result.id, token: result.token, url: result.url };
}
