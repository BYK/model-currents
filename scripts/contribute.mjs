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
import { buildWeeklySnapshot, fetchKnownModels, filterWeeklySnapshot } from '../src/weekly-snapshot.ts';

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

export async function publishSnapshot(snapshot, owner = null, fetchImpl = fetch, endpoint = api) {
    const body = brotliCompressSync(Buffer.from(JSON.stringify(snapshot)));
    const response = await fetchImpl(owner ? `${endpoint}/${owner.id}` : endpoint, {
        method: owner ? 'PUT' : 'POST',
        headers: {
            'Content-Type': 'application/vnd.model-tides.weekly+json',
            'Content-Encoding': 'br',
            'X-Model-Tides-Schema': 'weekly-v1',
            ...(owner ? { Authorization: `Bearer ${owner.token}` } : {}),
        },
        body,
    });
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}). Your local history was not saved to this site.`);
    return response.json();
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
    const localSnapshot = option === '--input'
        ? snapshotFromDocuments([readMetadata(readFileSync(sources[0].path))])
        : exportLocal(sources, console.log);
    if (localSnapshot.weeks.length === 0) throw new Error('No model observations found.');
    console.log('Checking model names against models.dev…');
    const { snapshot, excluded } = filterWeeklySnapshot(localSnapshot, await fetchKnownModels('https://modeltides.dev/api/models'));
    console.log(`Checked ${sources.map(({ name }) => name).join(', ')}. The following weekly counts would be shared:`);
    for (const { week, models } of snapshot.weeks) {
        console.log(`Week of ${week}`);
        for (const [model, count] of Object.entries(models)) console.log(`  ${model}: ${count}`);
    }
    if (excluded.length) console.log(`Not shared (not listed on models.dev): ${excluded.join(', ')}`);
    if (snapshot.weeks.length === 0) throw new Error('No models listed on models.dev were found in this history. Nothing was shared.');
    console.log('Only the displayed weeks, model names, and counts are uploaded. No prompts, replies, paths, exact times, or session IDs.');
    if (!await confirm(owner ? 'Replace these weeks in your existing shared link?' : 'Create a public contribution and save its private key locally?')) return;
    const result = await publishSnapshot(snapshot, owner);
    if (!owner) {
        try { saveNewCredential({ id: result.id, token: result.token }); }
        catch {
            const removed = await fetch(`${api}/${result.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${result.token}` } });
            throw new Error(removed.ok ? 'Could not save your private key; the new contribution was removed.' :
                'Could not save your private key or remove the new contribution.');
        }
    }
    console.log(`Public link: https://modeltides.dev/u/${owner?.id ?? result.id}`);
    console.log('A separate private replacement key is stored in your local config directory. Never share it.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
    main().catch((error) => { console.error(error instanceof Error ? error.message : 'Could not contribute.'); process.exitCode = 1; });
}
