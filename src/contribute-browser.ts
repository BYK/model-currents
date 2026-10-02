import { downloadBlob } from './share-image';
import type { UsageEvent } from './usage-data';
import { buildWeeklySnapshot, type WeeklySnapshot } from './weekly-snapshot';

interface ContributionState {
    snapshot: WeeklySnapshot | null;
    key: { id: string; token: string } | null;
    published: boolean | null;
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
        publicRow.hidden = state.published !== true;
        share.hidden = state.published !== false;
        unshare.hidden = state.published !== true;
        if (state.published === true) {
            publicLink.href = `/u/${state.key.id}`;
            publicLink.textContent = `${location.origin}/u/${state.key.id}`;
        } else {
            publicLink.removeAttribute('href');
            publicLink.textContent = '';
        }
    };
    const previewStatus = (): string => !state.key
        ? 'These exact counts will enter the community aggregate. Your new personal report stays private.'
        : state.published === true
            ? 'Your personal report is already public. These reviewed counts will appear there immediately after replacement.'
            : state.published === false
                ? 'These exact counts will replace matching weeks. Your personal report remains private.'
                : 'Could not confirm personal report visibility. Replacing weeks is unavailable until visibility is checked.';
    const setBusy = (busy: boolean): void => {
        confirm.disabled = busy || (!!state.key && state.published === null);
        close.disabled = busy;
        rotate.disabled = busy;
        remove.disabled = busy;
        share.disabled = busy;
        unshare.disabled = busy;
        keyFile.disabled = busy;
    };
    const reconcileVisibility = async (): Promise<boolean> => {
        const key = state.key;
        if (!key) return false;
        try {
            const response = await fetch(`/api/contributions/${key.id}`, {
                headers: { Authorization: `Bearer ${key.token}` }, cache: 'no-store',
            });
            if (!response.ok) throw new TypeError('Unknown visibility.');
            const saved: { id: string; published: boolean } = await response.json();
            if (saved.id !== key.id || typeof saved.published !== 'boolean') throw new TypeError('Unknown visibility.');
            if (state.key !== key) return false;
            state.published = saved.published;
            showKey();
            setBusy(false);
            return true;
        } catch {
            if (state.key === key) {
                state.published = null;
                showKey();
                setBusy(false);
            }
            return false;
        }
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
        if (!snapshot) {
            if (state.key && state.published === null) void reconcileVisibility().then((confirmed) => {
                status.textContent = confirmed ? 'Personal report visibility checked.' :
                    'Could not confirm personal report visibility. Try opening this dialog again.';
            });
            return;
        }
        if (snapshot.weeks.length === 0) {
            status.textContent = 'No model observations to upload.';
        } else {
            state.snapshot = snapshot;
            preview.textContent = snapshot.weeks.map(({ week, models }) =>
                `Week of ${week}\n${Object.entries(models).map(([model, count]) => `  ${model}: ${count}`).join('\n')}`).join('\n\n');
            status.textContent = previewStatus();
            confirm.hidden = false;
            confirm.textContent = state.key ? 'Replace these weeks' : 'Upload these weekly counts';
        }
        setBusy(false);
        if (state.key && state.published === null) void reconcileVisibility().then((confirmed) => {
            status.textContent = confirmed ? (state.snapshot ? previewStatus() : 'Personal report visibility checked.') :
                'Could not confirm personal report visibility. Try opening this dialog again.';
        });
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
            status.textContent = state.snapshot ? previewStatus() :
                'Private key loaded in this tab. You can manage this contribution.';
            confirm.textContent = 'Replace these weeks';
        } catch {
            status.textContent = 'Could not load this private key or its contribution.';
        } finally { setBusy(false); }
    });

    confirm.addEventListener('click', async () => {
        if (!state.snapshot || (state.key && state.published === null)) return;
        setBusy(true);
        status.textContent = 'Compressing and uploading only the displayed weekly counts…';
        try {
            const { default: brotli } = await import('brotli-wasm');
            const encoder = await brotli;
            const compressed = encoder.compress(new TextEncoder().encode(JSON.stringify(state.snapshot)), { quality: 5 });
            const response = await fetch(state.key ? `/api/contributions/${state.key.id}` : '/api/contributions/private', {
                method: state.key ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/vnd.model-tides.weekly+json',
                    'Content-Encoding': 'br',
                    'X-Model-Tides-Schema': 'weekly-v1',
                    ...(!state.key ? { 'X-Model-Tides-Report': 'private-v1' } : {}),
                    ...(state.key ? { Authorization: `Bearer ${state.key.token}`,
                        'X-Model-Tides-Expected-Visibility': state.published ? 'public' : 'private' } : {}),
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
            if (state.key) {
                state.published = null;
                showKey();
                const confirmed = await reconcileVisibility();
                status.textContent = confirmed ? `Could not confirm this replacement. ${previewStatus()} Review and try again.` :
                    'Could not confirm this replacement or report visibility. Reopen this dialog before retrying.';
            } else {
                status.textContent = 'Could not confirm this upload. Check your connection before trying again.';
            }
        } finally {
            setBusy(false);
        }
    });

    download.addEventListener('click', () => {
        if (!state.key) return;
        downloadBlob(new Blob([JSON.stringify(state.key, null, 2) + '\n'], { type: 'application/json' }), 'model-tides-private-key.json');
    });
    const setSharing = async (published: boolean): Promise<void> => {
        if (!state.key || state.published === null) return;
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
            status.textContent = !confirm.hidden && state.snapshot ? previewStatus() : published
                ? 'Personal report published. Anyone with the link can see these weekly counts.'
                : 'Personal report hidden. Your weekly counts still contribute to the community aggregate.';
        } catch {
            state.published = null;
            showKey();
            const confirmed = await reconcileVisibility();
            status.textContent = confirmed ? (state.snapshot && !confirm.hidden ? previewStatus() :
                state.published ? 'Personal report is public.' : 'Personal report is hidden.') :
                'Could not confirm personal report visibility. Try opening this dialog again.';
        }
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
