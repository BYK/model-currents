import { downloadBlob } from './share-image';
import type { UsageEvent } from './usage-data';
import { buildWeeklySnapshot, type WeeklySnapshot } from './weekly-snapshot';

interface ContributionState {
    snapshot: WeeklySnapshot | null;
    key: { id: string; token: string } | null;
}

export function setupContributions(
    button: HTMLButtonElement,
    dialog: HTMLDialogElement,
    getEvents: () => readonly UsageEvent[],
    refresh: () => Promise<void>,
): { clearSnapshot(): void } {
    const preview = dialog.querySelector<HTMLElement>('#contribution-preview')!;
    const status = dialog.querySelector<HTMLElement>('#contribution-status')!;
    const confirm = dialog.querySelector<HTMLButtonElement>('#confirm-contribution')!;
    const close = dialog.querySelector<HTMLButtonElement>('#close-contribution')!;
    const result = dialog.querySelector<HTMLElement>('#contribution-result')!;
    const publicLink = dialog.querySelector<HTMLAnchorElement>('#contribution-link')!;
    const download = dialog.querySelector<HTMLButtonElement>('#download-owner-key')!;
    const rotate = dialog.querySelector<HTMLButtonElement>('#rotate-owner-key')!;
    const remove = dialog.querySelector<HTMLButtonElement>('#delete-contribution')!;
    const keyFile = dialog.querySelector<HTMLInputElement>('#owner-key-file')!;
    const state: ContributionState = { snapshot: null, key: null };
    const setBusy = (busy: boolean): void => {
        confirm.disabled = busy;
        close.disabled = busy;
        rotate.disabled = busy;
        remove.disabled = busy;
        keyFile.disabled = busy;
    };
    dialog.addEventListener('cancel', (event) => {
        if (close.disabled) event.preventDefault();
    });

    button.addEventListener('click', () => {
        try {
            const snapshot = buildWeeklySnapshot(getEvents());
            if (snapshot.weeks.length === 0) throw new Error('No model observations to share.');
            state.snapshot = snapshot;
            preview.textContent = snapshot.weeks.map(({ week, models }) =>
                `Week of ${week}\n${Object.entries(models).map(([model, count]) => `  ${model}: ${count}`).join('\n')}`).join('\n\n');
            status.textContent = state.key
                ? 'These exact counts will replace the matching weeks at your existing public link.'
                : 'These exact counts will be public. Your original history stays in this tab.';
            result.hidden = true;
            confirm.hidden = false;
            confirm.textContent = state.key ? 'Replace these weeks' : 'Upload these weekly counts';
            dialog.showModal();
        } catch {
            status.textContent = 'Cannot share this history: check its model names, dates, and weekly upload limits.';
            dialog.showModal();
        }
    });

    keyFile.addEventListener('change', async () => {
        const file = keyFile.files?.[0];
        keyFile.value = '';
        if (!file || file.size > 4096) return;
        try {
            const value: unknown = JSON.parse(await file.text());
            if (!value || typeof value !== 'object' || Array.isArray(value) ||
                Object.keys(value).sort().join() !== 'id,token' || !('id' in value) || !('token' in value) ||
                typeof value.id !== 'string' || typeof value.token !== 'string' ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) ||
                !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new TypeError('Invalid private key.');
            state.key = { id: value.id, token: value.token };
            status.textContent = 'Private key loaded in this tab. Matching weeks will be replaced at your existing link.';
            confirm.textContent = 'Replace these weeks';
        } catch {
            status.textContent = 'That file is not a Model Tides private key.';
        }
    });

    confirm.addEventListener('click', async () => {
        if (!state.snapshot) return;
        setBusy(true);
        status.textContent = 'Compressing and uploading only the displayed weekly counts…';
        try {
            const { default: brotli } = await import('brotli-wasm');
            const encoder = await brotli;
            const compressed = encoder.compress(new TextEncoder().encode(JSON.stringify(state.snapshot)), { quality: 5 });
            const response = await fetch(state.key ? `/api/contributions/${state.key.id}` : '/api/contributions', {
                method: state.key ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/vnd.model-tides.weekly+json',
                    'Content-Encoding': 'br',
                    'X-Model-Tides-Schema': 'weekly-v1',
                    ...(state.key ? { Authorization: `Bearer ${state.key.token}` } : {}),
                },
                body: new Blob([Uint8Array.from(compressed)]),
                cache: 'no-store',
            });
            if (!response.ok) throw new Error('Upload failed. Nothing was shared.');
            const saved: { id: string; token?: string } = await response.json();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.id) ||
                (state.key && saved.id !== state.key.id) ||
                (!state.key && (typeof saved.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.token)))) {
                throw new Error('Invalid upload response.');
            }
            state.key = state.key ?? { id: saved.id, token: saved.token! };
            publicLink.href = `/u/${state.key.id}`;
            publicLink.textContent = `${location.origin}/u/${state.key.id}`;
            confirm.hidden = true;
            result.hidden = false;
            status.textContent = 'Shared. Save your private key before closing this tab; only that key can replace or delete this link.';
            void refresh();
        } catch {
            status.textContent = 'Could not share these counts. Check your connection and try again.';
        } finally {
            setBusy(false);
        }
    });

    download.addEventListener('click', () => {
        if (!state.key) return;
        downloadBlob(new Blob([JSON.stringify(state.key, null, 2) + '\n'], { type: 'application/json' }), 'model-tides-private-key.json');
    });
    rotate.addEventListener('click', async () => {
        if (!state.key) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/contributions/${state.key.id}/rotate`, {
                method: 'POST', headers: { Authorization: `Bearer ${state.key.token}` },
            });
            if (!response.ok) throw new Error('Rotation failed.');
            const { token }: { token: string } = await response.json();
            if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid rotation response.');
            state.key = { id: state.key.id, token };
            status.textContent = 'Private key rotated. Download the new key now; the old file no longer works.';
        } catch { status.textContent = 'Could not rotate the private key. Try again.'; }
        finally { setBusy(false); }
    });
    remove.addEventListener('click', async () => {
        if (!state.key || !window.confirm('Permanently delete this public contribution?')) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/contributions/${state.key.id}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${state.key.token}` },
            });
            if (!response.ok) throw new Error('Deletion failed.');
            state.key = null;
            result.hidden = true;
            status.textContent = 'Shared contribution deleted. Your imported history remains in this tab.';
            void refresh();
        } catch { status.textContent = 'Could not delete the contribution. Try again.'; }
        finally { setBusy(false); }
    });
    return { clearSnapshot() { state.snapshot = null; dialog.close(); } };
}
