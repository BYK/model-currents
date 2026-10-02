import { downloadBlob } from './share-image';
import type { UsageEvent } from './usage-data';
import { buildWeeklySnapshot, type WeeklySnapshot } from './weekly-snapshot';

interface ContributionState {
    snapshot: WeeklySnapshot | null;
    key: { id: string; token: string } | null;
    published: boolean;
}

export function setupContributions(
    button: HTMLButtonElement,
    manageButton: HTMLButtonElement,
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
    const publicRow = dialog.querySelector<HTMLElement>('#contribution-public')!;
    const download = dialog.querySelector<HTMLButtonElement>('#download-owner-key')!;
    const share = dialog.querySelector<HTMLButtonElement>('#share-contribution')!;
    const unshare = dialog.querySelector<HTMLButtonElement>('#unshare-contribution')!;
    const rotate = dialog.querySelector<HTMLButtonElement>('#rotate-owner-key')!;
    const remove = dialog.querySelector<HTMLButtonElement>('#delete-contribution')!;
    const keyFile = dialog.querySelector<HTMLInputElement>('#owner-key-file')!;
    const state: ContributionState = { snapshot: null, key: null, published: false };
    const showKey = (): void => {
        if (!state.key) return;
        result.hidden = false;
        publicRow.hidden = !state.published;
        share.hidden = state.published;
        unshare.hidden = !state.published;
        if (state.published) {
            publicLink.href = `/u/${state.key.id}`;
            publicLink.textContent = `${location.origin}/u/${state.key.id}`;
        }
    };
    const setBusy = (busy: boolean): void => {
        confirm.disabled = busy;
        close.disabled = busy;
        rotate.disabled = busy;
        remove.disabled = busy;
        share.disabled = busy;
        unshare.disabled = busy;
        keyFile.disabled = busy;
    };
    dialog.addEventListener('cancel', (event) => {
        if (close.disabled) event.preventDefault();
    });

    const open = (): void => {
        state.snapshot = null;
        preview.textContent = '';
        confirm.hidden = true;
        result.hidden = !state.key;
        showKey();
        dialog.showModal();
        const snapshot = (() => {
            try {
                return buildWeeklySnapshot(getEvents());
            } catch {
                status.textContent = 'Cannot upload this history: check its model names, dates, and weekly upload limits.';
                return null;
            }
        })();
        if (!snapshot) return;
        if (snapshot.weeks.length === 0) {
            status.textContent = 'No model observations to upload.';
            return;
        }
        state.snapshot = snapshot;
        preview.textContent = snapshot.weeks.map(({ week, models }) =>
            `Week of ${week}\n${Object.entries(models).map(([model, count]) => `  ${model}: ${count}`).join('\n')}`).join('\n\n');
        status.textContent = state.key
            ? 'These exact counts will replace matching weeks in your contribution. Your personal report keeps its current visibility.'
            : 'These exact counts will enter the community aggregate. Your personal report stays private.';
        confirm.hidden = false;
        confirm.textContent = state.key ? 'Replace these weeks' : 'Upload these weekly counts';
    };
    button.addEventListener('click', open);
    manageButton.addEventListener('click', open);

    keyFile.addEventListener('change', async () => {
        const file = keyFile.files?.[0];
        keyFile.value = '';
        if (!file || file.size > 4096) return;
        setBusy(true);
        try {
            const value: unknown = JSON.parse(await file.text());
            if (!value || typeof value !== 'object' || Array.isArray(value) ||
                Object.keys(value).sort().join() !== 'id,token' || !('id' in value) || !('token' in value) ||
                typeof value.id !== 'string' || typeof value.token !== 'string' ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) ||
                !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new TypeError('Invalid private key.');
            const response = await fetch(`/api/contributions/${value.id}`, {
                headers: { Authorization: `Bearer ${value.token}` }, cache: 'no-store',
            });
            if (!response.ok) throw new TypeError('Invalid private key.');
            const saved: { id: string; published: boolean } = await response.json();
            if (saved.id !== value.id || typeof saved.published !== 'boolean') throw new TypeError('Invalid contribution.');
            state.key = { id: value.id, token: value.token };
            state.published = saved.published;
            showKey();
            status.textContent = 'Private key loaded in this tab. You can manage this contribution or replace matching weeks.';
            confirm.textContent = 'Replace these weeks';
        } catch {
            status.textContent = 'Could not load this private key or its contribution.';
        } finally { setBusy(false); }
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
                    ...(!state.key ? { 'X-Model-Tides-Report': 'private-v1' } : {}),
                    ...(state.key ? { Authorization: `Bearer ${state.key.token}` } : {}),
                },
                body: new Blob([Uint8Array.from(compressed)]),
                cache: 'no-store',
            });
            if (!response.ok) throw new Error('Upload failed.');
            const saved: { id: string; token?: string; published?: boolean } = await response.json();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.id) ||
                (state.key && saved.id !== state.key.id) ||
                typeof saved.published !== 'boolean' ||
                (!state.key && (typeof saved.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.token)))) {
                throw new Error('Invalid upload response.');
            }
            state.key = state.key ?? { id: saved.id, token: saved.token! };
            state.published = saved.published;
            confirm.hidden = true;
            showKey();
            status.textContent = state.published
                ? 'Counts updated. Your personal report remains public; save your private key to keep control of it.'
                : 'Counts uploaded. Your personal report is private. Download your private key before closing this tab; you need it to share, replace, or delete your contribution.';
            void refresh();
        } catch {
            status.textContent = 'Could not upload these counts. Check your connection and try again.';
        } finally {
            setBusy(false);
        }
    });

    download.addEventListener('click', () => {
        if (!state.key) return;
        downloadBlob(new Blob([JSON.stringify(state.key, null, 2) + '\n'], { type: 'application/json' }), 'model-tides-private-key.json');
    });
    const setSharing = async (published: boolean): Promise<void> => {
        if (!state.key) return;
        if (published && !window.confirm('Publish your personal weekly counts at a public link?')) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/contributions/${state.key.id}/${published ? 'share' : 'unshare'}`, {
                method: 'POST', headers: { Authorization: `Bearer ${state.key.token}` }, cache: 'no-store',
            });
            if (!response.ok) throw new Error('Sharing change failed.');
            const saved: { id: string; published: boolean; url?: string } = await response.json();
            if (saved.id !== state.key.id || saved.published !== published ||
                (published && saved.url !== `${location.origin}/u/${state.key.id}`)) {
                throw new Error('Invalid sharing response.');
            }
            state.published = published;
            showKey();
            status.textContent = published ? 'Personal report published. Anyone with the link can see these weekly counts.' :
                'Personal report hidden. Your weekly counts still contribute to the community aggregate.';
        } catch { status.textContent = 'Could not change personal report visibility. Try again.'; }
        finally { setBusy(false); }
    };
    share.addEventListener('click', () => { void setSharing(true); });
    unshare.addEventListener('click', () => { void setSharing(false); });
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
        if (!state.key || !window.confirm('Permanently delete your weekly counts from the community aggregate?')) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/contributions/${state.key.id}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${state.key.token}` },
            });
            if (!response.ok) throw new Error('Deletion failed.');
            state.key = null;
            state.published = false;
            result.hidden = true;
            status.textContent = 'Contribution deleted. Your imported history remains in this tab.';
            void refresh();
        } catch { status.textContent = 'Could not delete the contribution. Try again.'; }
        finally { setBusy(false); }
    });
    return { clearSnapshot() { state.snapshot = null; dialog.close(); } };
}
