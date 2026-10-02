import { parseSnapshot, type WeeklySnapshot } from './weekly-snapshot.ts';

const gistId = /^[0-9a-f]{32}$/;
const gistOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const gistFile = 'model-tides-weekly.json';
const maxGistResponseBytes = 4 * 1024 * 1024;
const maxSnapshotBytes = 512 * 1024;

export function gistAddress(owner: string, id: string): string {
    if (!gistOwner.test(owner) || !gistId.test(id)) throw new TypeError('Invalid gist address.');
    return `https://modeltides.dev/gist/${owner}/${id}`;
}

async function boundedJson(response: Response): Promise<unknown> {
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxGistResponseBytes)) {
        throw new TypeError('Gist response is too large.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new TypeError('Missing gist response.');
    const chunks: Uint8Array[] = [];
    const count = { value: 0 };
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        count.value += value.byteLength;
        if (count.value > maxGistResponseBytes) {
            await reader.cancel();
            throw new TypeError('Gist response is too large.');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(count.value);
    const offset = { value: 0 };
    for (const chunk of chunks) {
        bytes.set(chunk, offset.value);
        offset.value += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function loadGistSnapshot(owner: string, id: string, fetchImpl: typeof fetch = fetch): Promise<WeeklySnapshot> {
    gistAddress(owner, id);
    try {
        const response = await fetchImpl(`https://api.github.com/gists/${id}`, {
            headers: { Accept: 'application/vnd.github+json' },
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
        });
        if (!response.ok) throw new TypeError('Gist unavailable.');
        const gist = await boundedJson(response);
        if (!gist || typeof gist !== 'object' || !('id' in gist) || gist.id !== id ||
            !('owner' in gist) || !gist.owner || typeof gist.owner !== 'object' ||
            !('login' in gist.owner) || typeof gist.owner.login !== 'string' ||
            gist.owner.login.toLowerCase() !== owner.toLowerCase() ||
            !('files' in gist) || !gist.files || typeof gist.files !== 'object' ||
            Object.keys(gist.files).length !== 1 || !(gistFile in gist.files)) {
            throw new TypeError('Unexpected gist.');
        }
        const file: unknown = (gist.files as Record<string, unknown>)[gistFile];
        if (!file || typeof file !== 'object' || !('content' in file) ||
            typeof file.content !== 'string' || !('truncated' in file) || file.truncated !== false ||
            new TextEncoder().encode(file.content).byteLength > maxSnapshotBytes) {
            throw new TypeError('Unexpected gist file.');
        }
        return parseSnapshot(JSON.parse(file.content));
    } catch {
        throw new TypeError('Could not load a valid weekly-count gist.');
    }
}
