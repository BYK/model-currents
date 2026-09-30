import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { extractOpenCodeUsage } from './opencode-extract';
import { MAX_DATABASE_BYTES } from './usage-data';

self.onmessage = async (event: MessageEvent<unknown>) => {
    const file = event.data;
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_DATABASE_BYTES) {
        self.postMessage({ ok: false, error: 'Choose an OpenCode database under 256 MB. For larger databases, use the local export script.' });
        return;
    }

    try {
        const SQL = await initSqlJs({ locateFile: () => wasmUrl });
        const database = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
        try {
            self.postMessage({ ok: true, document: extractOpenCodeUsage(database) });
        } finally {
            database.close();
        }
    } catch {
        self.postMessage({ ok: false, error: 'Could not read this OpenCode database. Try the local export script for a complete snapshot.' });
    }
};
