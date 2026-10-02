#!/usr/bin/env node
/** Discover local harnesses, show the exact weekly snapshot, then ask before sending it. */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { brotliCompressSync } from 'node:zlib';
import { parseUsageDocument, MAX_EVENTS, MAX_JSON_BYTES } from '../src/usage-data.ts';
import { buildWeeklySnapshot } from '../src/weekly-snapshot.ts';

const scripts = new URL('.', import.meta.url);
const api = 'https://modeltides.dev/api/contributions';
const credential = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'model-tides', 'contribution.json');

const regular = (path) => {
    try { return lstatSync(path).isFile(); } catch { return false; }
};
const directory = (path) => {
    try { return lstatSync(path).isDirectory(); } catch { return false; }
};

function hasHistory(root, source) {
    if (source !== 'codex' && source !== 'claude-code') throw new TypeError('Unsupported history source.');
    if (!directory(root)) return false;
    const pending = [root];
    try {
        while (pending.length) {
            const current = pending.pop();
            for (const entry of readdirSync(current, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                    if (source !== 'claude-code' || entry.name !== 'subagents') pending.push(join(current, entry.name));
                } else if (entry.isFile() && (source === 'codex'
                    ? entry.name.startsWith('rollout-') && /\.jsonl(?:\.zst)?$/.test(entry.name)
                    : entry.name.endsWith('.jsonl') && !entry.name.startsWith('agent-'))) {
                    return true;
                }
            }
        }
    } catch {
        throw new Error('Could not scan local history directories.');
    }
    return false;
}

function readMetadata(bytes) {
    if (bytes.length > MAX_JSON_BYTES) throw new Error('Metadata exceeds the local import limit.');
    try {
        return parseUsageDocument(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
        if (error instanceof SyntaxError) throw new TypeError('Expected a Model Tides v1 metadata file.');
        throw error;
    }
}

export function collectSources(home = homedir()) {
    const opencode = join(home, '.local/share/opencode/opencode.db');
    const codex = join(home, '.codex');
    const claude = join(home, '.claude/projects');
    return [
        ...(regular(opencode) ? [{ name: 'OpenCode', path: opencode, script: 'export-model-tides.py', args: [] }] : []),
        ...(hasHistory(codex, 'codex') ? [{ name: 'Codex', path: codex, script: 'export-history.py', args: ['codex'] }] : []),
        ...(hasHistory(claude, 'claude-code') ? [{ name: 'Claude Code', path: claude, script: 'export-history.py', args: ['claude-code'] }] : []),
    ];
}

export function snapshotFromDocuments(documents) {
    return buildWeeklySnapshot((function* () {
        for (const document of documents) {
            const parsed = parseUsageDocument(document);
            if (parsed.source === 'example') throw new Error('Mock data cannot be contributed.');
            yield* parsed.events;
        }
    })());
}

function documentsFromSources(sources, onProgress = () => {}) {
    const documents = [];
    for (const source of sources) {
        onProgress(`Scanning ${source.name} history…`);
        const script = fileURLToPath(new URL(source.script, scripts));
        const result = spawnSync('python3', [script, ...source.args, source.path], {
            encoding: 'buffer', maxBuffer: MAX_JSON_BYTES + 1024, timeout: 120_000,
        });
        if (result.error || result.status !== 0) {
            if (result.error?.code === 'ETIMEDOUT') throw new Error(`${source.name} scan timed out. Try exporting this harness separately.`);
            if (result.error?.code === 'ENOENT') throw new Error('Python 3 is required to read local history.');
            const reason = result.stderr?.toString('utf8').trim();
            if (reason === 'No model observations found in this history.') {
                onProgress(`${source.name} has no model observations; skipped.`);
                continue;
            }
            const fixedReasons = new Map([
                ['Compressed Codex history requires zstd. Install it locally and retry.', 'Compressed Codex history requires zstd. Install it locally and retry.'],
                ['A complete history record is malformed. Nothing was exported.', `${source.name} has a malformed history record. Nothing was exported.`],
            ]);
            if (fixedReasons.has(reason)) throw new Error(fixedReasons.get(reason));
            throw new Error(`${source.name} could not be read. Check its local history and converter requirements.`);
        }
        const document = readMetadata(result.stdout);
        if (!document.events.length) {
            onProgress(`${source.name} has no model observations; skipped.`);
            continue;
        }
        documents.push(document);
        onProgress(`${source.name} scan complete.`);
    }
    return documents;
}

export function exportLocal(sources, onProgress) {
    return snapshotFromDocuments(documentsFromSources(sources, onProgress));
}

export function exportLocalMetadata(sources, onProgress) {
    const documents = documentsFromSources(sources, onProgress);
    const events = documents.flatMap(({ events }) => events);
    if (events.length > MAX_EVENTS) throw new Error('Combined history exceeds the browser import limit. Export one harness at a time.');
    const document = parseUsageDocument({
        format: 'model-tides', version: 1,
        source: documents.length === 1 ? documents[0].source : 'multiple',
        events: events.sort((left, right) => left.time - right.time),
    });
    if (!document.events.length) throw new Error('No model observations found.');
    return document;
}

export async function publishSnapshot(snapshot, owner = null, fetchImpl = fetch, endpoint = api, published = null) {
    if (owner && typeof published !== 'boolean') throw new TypeError('Expected report visibility.');
    const body = brotliCompressSync(Buffer.from(JSON.stringify(snapshot)));
    const response = await fetchImpl(owner ? `${endpoint}/${owner.id}` : `${endpoint}/private`, {
        method: owner ? 'PUT' : 'POST',
        headers: {
            'Content-Type': 'application/vnd.model-tides.weekly+json',
            'Content-Encoding': 'br',
            'X-Model-Tides-Schema': 'weekly-v1',
            ...(!owner ? { 'X-Model-Tides-Report': 'private-v1' } : {}),
            ...(owner ? { Authorization: `Bearer ${owner.token}`,
                'X-Model-Tides-Expected-Visibility': published ? 'public' : 'private' } : {}),
        },
        body,
    });
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}). No successful upload was confirmed; your local history is unchanged.`);
    return response.json();
}

export async function setSharing(owner, published, fetchImpl = fetch, endpoint = api) {
    const response = await fetchImpl(`${endpoint}/${owner.id}/${published ? 'share' : 'unshare'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
    });
    if (!response.ok) throw new Error(`Sharing change failed (HTTP ${response.status}).`);
    const result = await response.json();
    if (result.id !== owner.id || result.published !== published ||
        (published && result.url !== `${new URL(endpoint).origin}/u/${owner.id}`)) {
        throw new Error('Invalid sharing response.');
    }
    return result;
}

export async function reportVisibility(owner, fetchImpl = fetch, endpoint = api) {
    try {
        const response = await fetchImpl(`${endpoint}/${owner.id}`, {
            headers: { Authorization: `Bearer ${owner.token}` }, cache: 'no-store',
        });
        if (!response.ok) throw new TypeError('Unknown visibility.');
        const result = await response.json();
        if (!result || result.id !== owner.id || typeof result.published !== 'boolean') {
            throw new TypeError('Unknown visibility.');
        }
        return result.published;
    } catch {
        throw new Error('Could not confirm personal report visibility. No upload was started.');
    }
}

function loadCredential() {
    if (!existsSync(credential)) return null;
    const stats = lstatSync(credential);
    if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
        throw new Error('Private key file must be a regular file readable only by you.');
    }
    if (stats.size > 4096) throw new Error('Invalid local private key file.');
    const owner = (() => {
        try { return JSON.parse(readFileSync(credential, 'utf8')); }
        catch (error) {
            if (error instanceof SyntaxError) throw new Error('Invalid local private key file.');
            throw error;
        }
    })();
    if (!owner || Object.keys(owner).sort().join() !== 'id,token' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(owner.token)) throw new Error('Invalid local private key file.');
    return owner;
}

function saveNewCredential(owner) {
    mkdirSync(dirname(credential), { recursive: true, mode: 0o700 });
    if (!directory(dirname(credential))) throw new Error('Private key directory must not be a symlink.');
    writeFileSync(credential, JSON.stringify(owner) + '\n', { mode: 0o600, flag: 'wx' });
}

async function confirm(question) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await prompt.question(`${question} Type YES to confirm: `)) === 'YES'; }
    finally { prompt.close(); }
}

function preview(snapshot) {
    if (snapshot.weeks.length === 0) throw new Error('No model observations found.');
    for (const { week, models } of snapshot.weeks) {
        console.log(`Week of ${week}`);
        for (const [model, count] of Object.entries(models)) console.log(`  ${model}: ${count}`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args[0] === 'export') {
        if (args.length !== 1 && (args.length !== 3 || args[1] !== '--output' || !args[2])) {
            throw new Error('Usage: model-tides export [--output metadata.json]');
        }
        const sources = collectSources();
        if (!sources.length) throw new Error('No supported harness history was found.');
        const document = exportLocalMetadata(sources, console.log);
        const bytes = Buffer.from(JSON.stringify(document) + '\n');
        if (bytes.length > MAX_JSON_BYTES) throw new Error('Combined metadata exceeds the browser import limit. Export one harness at a time.');
        const output = args[2] ?? 'model-tides.json';
        writeFileSync(output, bytes, { mode: 0o600, flag: 'wx' });
        console.log(`Saved ${document.events.length} model events to ${output}. Open it at https://modeltides.dev/local/. This file contains exact event timestamps; keep it private.`);
        return;
    }
    if (args[0] === 'gist') {
        if (args.length !== 1 && (args.length !== 3 || args[1] !== '--input' || !args[2])) {
            throw new Error('Usage: model-tides gist [--input metadata.json]');
        }
        const input = args[2];
        if (input && !regular(input)) throw new Error('Input must be a regular metadata JSON file.');
        const sources = input ? [] : collectSources();
        if (!input && !sources.length) throw new Error('No supported harness history was found. Use --input for an existing metadata JSON.');
        const snapshot = input ? snapshotFromDocuments([readMetadata(readFileSync(input))]) : exportLocal(sources, console.log);
        console.log('The following weekly counts would go into an unlisted GitHub gist:');
        preview(snapshot);
        console.log('Anyone with the gist URL can read these counts. GitHub stores the gist and its revisions. No exact event times, source paths, prompts, replies, or session IDs are included.');
        if (!await confirm('Create this unlisted gist of weekly counts?')) return;
        const created = spawnSync('gh', ['gist', 'create', '--filename', 'model-tides-weekly.json', '-'], {
            input: JSON.stringify(snapshot) + '\n', encoding: 'utf8', timeout: 30_000, maxBuffer: 1024,
        });
        if (created.error?.code === 'ENOENT') throw new Error('GitHub CLI (gh) is required to create a gist.');
        if (created.error || created.status !== 0) throw new Error('Could not create the unlisted gist. Check that gh is authenticated with gist access.');
        const url = created.stdout.trim();
        const match = /^https:\/\/gist\.github\.com\/(?:(\w[\w-]{0,38})\/)?([a-f0-9]{32})$/.exec(url);
        if (!match) {
            throw new Error('GitHub CLI returned an invalid gist URL.');
        }
        console.log(`Unlisted gist: ${url}`);
        const identity = match[1] ? null : spawnSync('gh', ['api', 'user', '--jq', '.login'], {
            encoding: 'utf8', timeout: 10_000, maxBuffer: 256,
        });
        const owner = match[1] ?? (identity?.status === 0 ? identity.stdout.trim() : '');
        if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
            console.log(`View in browser: https://modeltides.dev/gist/${owner}/${match[2]}`);
        } else {
            console.log('The gist was created. Its Model Tides viewer link could not be determined; open the gist URL above.');
        }
        return;
    }
    if (args[0] === 'link') {
        if (args.length !== 1) throw new Error('Usage: model-tides link');
        const owner = loadCredential();
        if (!owner) throw new Error('No private key file exists for this contribution.');
        console.log(`Public link: https://modeltides.dev/u/${owner.id}`);
        console.log('This link works only while your personal report is shared. Run model-tides share to publish it.');
        return;
    }
    if (args[0] === 'share' || args[0] === 'unshare') {
        if (args.length !== 1) throw new Error('Usage: model-tides share | unshare');
        const owner = loadCredential();
        if (!owner) throw new Error('No private key file exists for this contribution. Upload weekly counts first.');
        const published = args[0] === 'share';
        if (!await confirm(published
            ? 'Publish your personal weekly counts at a public link?'
            : 'Hide your personal report? Your counts will still contribute to the aggregate.')) return;
        await setSharing(owner, published);
        console.log(published ? `Public link: https://modeltides.dev/u/${owner.id}` :
            'Your personal report is hidden. Your weekly counts still contribute to the aggregate.');
        return;
    }
    if (args[0] === 'upload') args.shift();
    const option = args[0];
    if (args.length > 2 || (option && !['--input', '--delete', '--rotate'].includes(option)) ||
        ((option === '--input') !== (args.length === 2))) {
        throw new Error('Usage: model-tides upload [--input metadata.json | --delete | --rotate]');
    }
    const owner = loadCredential();
    if (option === '--delete' || option === '--rotate') {
        if (!owner) throw new Error('No private key file exists for this contribution.');
        if (!await confirm(option === '--delete' ? 'Delete your shared weekly counts?' : 'Rotate your private replacement key?')) return;
        const response = await fetch(`${api}/${owner.id}${option === '--rotate' ? '/rotate' : ''}`, {
            method: option === '--rotate' ? 'POST' : 'DELETE',
            headers: { Authorization: `Bearer ${owner.token}` },
        });
        if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}).`);
        if (option === '--delete') {
            unlinkSync(credential);
            console.log('Your shared weekly counts were deleted.');
        } else {
            const { token } = await response.json();
            const temporary = `${credential}.new`;
            writeFileSync(temporary, JSON.stringify({ id: owner.id, token }) + '\n', { mode: 0o600, flag: 'wx' });
            renameSync(temporary, credential);
            console.log('Your private replacement key was rotated.');
        }
        return;
    }

    const sources = option === '--input' ? [{ name: 'metadata file', path: args[1] }] : collectSources();
    if (!sources.length) throw new Error('No supported harness history was found. Use --input for an existing metadata JSON.');
    if (option === '--input' && !regular(sources[0].path)) throw new Error('Input must be a regular metadata JSON file.');
    const snapshot = option === '--input'
        ? snapshotFromDocuments([readMetadata(readFileSync(sources[0].path))])
        : exportLocal(sources, console.log);
    console.log(`Checked ${sources.map(({ name }) => name).join(', ')}. The following weekly counts would be uploaded:`);
    preview(snapshot);
    console.log('Only the displayed weeks, model names, and counts are uploaded. No prompts, replies, paths, exact times, or session IDs.');
    const published = owner ? await reportVisibility(owner) : false;
    if (owner) {
        console.log(published
            ? 'Your personal report is already public. These reviewed counts will be public immediately after replacement.'
            : 'Your personal report is private. Replacing these weeks keeps it private.');
    } else {
        console.log('Your new personal report stays private until you choose to share it.');
    }
    if (!await confirm(owner ? 'Replace these weeks in your existing contribution?' : 'Upload to the aggregate and save a private key locally?')) return;
    const result = await publishSnapshot(snapshot, owner, fetch, api, published);
    if (!result || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.id) ||
        result.id !== (owner?.id ?? result.id) || typeof result.published !== 'boolean' ||
        (!owner && (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token)))) {
        throw new Error('Invalid upload response.');
    }
    if (!owner) {
        try { saveNewCredential({ id: result.id, token: result.token }); }
        catch {
            const removed = await fetch(`${api}/${result.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${result.token}` } });
            throw new Error(removed.ok ? 'Could not save your private key; the new contribution was removed.' :
                'Could not save your private key or remove the new contribution.');
        }
    }
    console.log(result.published ? `Public link: https://modeltides.dev/u/${result.id}` :
        'Weekly counts uploaded to the aggregate. Your personal report is private. Run model-tides share to publish it.');
    console.log('A separate private replacement key is stored in your local config directory. Never share it.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
    main().catch((error) => { console.error(error instanceof Error ? error.message : 'Could not contribute.'); process.exitCode = 1; });
}
