import { downloadBlob } from './share-image';
import type { UsageEvent } from './usage-data';
import { buildWeeklySnapshot, parseOwnedReport, type OwnedReport, type WeeklySnapshot } from './weekly-snapshot';

interface ContributionState {
    snapshot: WeeklySnapshot | null;
    key: { id: string; token: string } | null;
    published: boolean | null;
    inAggregate: boolean | null;
    report: OwnedReport | null;
}

export function setupContributions(
    button: HTMLButtonElement,
    manageButton: HTMLButtonElement,
    dialog: HTMLDialogElement,
    getEvents: () => readonly UsageEvent[],
    refresh: () => Promise<void>,
): { clearSnapshot(): void } {
    const preview = dialog.querySelector<HTMLElement>('#contribution-preview')!;
    const stored = dialog.querySelector<HTMLElement>('#stored-counts')!;
    const status = dialog.querySelector<HTMLElement>('#contribution-status')!;
    const confirm = dialog.querySelector<HTMLButtonElement>('#confirm-contribution')!;
    const close = dialog.querySelector<HTMLButtonElement>('#close-contribution')!;
    const result = dialog.querySelector<HTMLElement>('#contribution-result')!;
    const publicLink = dialog.querySelector<HTMLAnchorElement>('#contribution-link')!;
    const publicRow = dialog.querySelector<HTMLElement>('#contribution-public')!;
    const download = dialog.querySelector<HTMLButtonElement>('#download-owner-key')!;
    const share = dialog.querySelector<HTMLButtonElement>('#share-contribution')!;
    const unshare = dialog.querySelector<HTMLButtonElement>('#unshare-contribution')!;
    const aggregate = dialog.querySelector<HTMLButtonElement>('#aggregate-contribution');
    const withdraw = dialog.querySelector<HTMLButtonElement>('#withdraw-contribution');
    const rotate = dialog.querySelector<HTMLButtonElement>('#rotate-owner-key')!;
    const remove = dialog.querySelector<HTMLButtonElement>('#delete-contribution')!;
    const keyFile = dialog.querySelector<HTMLInputElement>('#owner-key-file')!;
    const state: ContributionState = { snapshot: null, key: null, published: false, inAggregate: false, report: null };
    const read = { version: 0 };
    const formatCounts = (snapshot: WeeklySnapshot): string => snapshot.weeks.map(({ week, models }) =>
        `Week of ${week}\n${Object.entries(models).map(([model, count]) => `  ${model}: ${count}`).join('\n')}`).join('\n\n');
    const showKey = (): void => {
        if (!state.key) return;
        result.hidden = false;
        publicRow.hidden = state.published !== true;
        share.hidden = state.published !== false || !state.report?.snapshot;
        unshare.hidden = state.published !== true;
        if (aggregate) aggregate.hidden = state.inAggregate !== false || !state.report?.snapshot;
        if (withdraw) withdraw.hidden = state.inAggregate !== true;
        if (state.published === true) {
            publicLink.href = `/u/${state.key.id}`;
            publicLink.textContent = `${location.origin}/u/${state.key.id}`;
        } else {
            publicLink.removeAttribute('href');
            publicLink.textContent = '';
        }
    };
    const previewStatus = (): string => {
        if (!state.key) return 'These weekly counts will create a personal chart viewable by anyone with its link. They will not enter the community aggregate.';
        if (state.published === null || state.inAggregate === null) {
            return 'Could not confirm personal report visibility or aggregate participation. Replacing weeks is unavailable until both are checked.';
        }
        const visibility = state.published
            ? 'Your personal report is already public. These reviewed counts will appear there immediately after replacement.'
            : 'These exact counts will replace matching weeks. Your personal report remains private.';
        return `${visibility} ${state.inAggregate
            ? 'These counts also update your existing community aggregate contribution. Remove counts from the community aggregate to opt out.'
            : 'These counts stay outside the community aggregate unless you opt in.'}`;
    };
    const setBusy = (busy: boolean): void => {
        confirm.disabled = busy || (!!state.key && (state.published === null || state.inAggregate === null || state.report?.snapshot === null));
        close.disabled = busy;
        rotate.disabled = busy;
        remove.disabled = busy;
        share.disabled = busy || !state.report?.snapshot;
        unshare.disabled = busy;
        if (aggregate) aggregate.disabled = busy || !state.report?.snapshot;
        if (withdraw) withdraw.disabled = busy;
        keyFile.disabled = busy;
    };
    const reconcileVisibility = async (): Promise<boolean> => {
        const key = state.key;
        if (!key) return false;
        const version = ++read.version;
        try {
            const response = await fetch(`/api/contributions/${key.id}`, {
                headers: { Authorization: `Bearer ${key.token}` }, cache: 'no-store',
            });
            if (!response.ok) throw new TypeError('Unknown visibility.');
            const saved = parseOwnedReport(await response.json(), key.id);
            if (state.key !== key || read.version !== version) return false;
            state.report = saved;
            state.published = saved.published;
            state.inAggregate = saved.inAggregate;
            stored.textContent = saved.snapshot ? formatCounts(saved.snapshot) : '';
            stored.hidden = !saved.snapshot;
            showKey();
            setBusy(false);
            return true;
        } catch {
            if (state.key === key && read.version === version) {
                state.report = null;
                state.published = null;
                state.inAggregate = null;
                stored.textContent = '';
                stored.hidden = true;
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
        read.version++;
        state.snapshot = null;
        if (state.key) {
            state.report = null;
            state.published = null;
            state.inAggregate = null;
            stored.textContent = '';
            stored.hidden = true;
        }
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
            if (state.key) {
                const pending = reconcileVisibility();
                const version = read.version;
                void pending.then((confirmed) => {
                    if (version !== read.version) return;
                    status.textContent = confirmed ? (state.report?.snapshot
                        ? 'Stored counts and personal report visibility checked.'
                        : 'This report is too large to review here. You can still hide or delete it.') :
                    'Could not confirm personal report visibility. Try opening this dialog again.';
                });
            }
            return;
        }
        if (snapshot.weeks.length === 0) {
            status.textContent = 'No model observations to upload.';
        } else {
            state.snapshot = snapshot;
            preview.textContent = formatCounts(snapshot);
            status.textContent = previewStatus();
            confirm.hidden = false;
            confirm.textContent = state.key ? 'Replace these weeks' : 'Publish this personal chart';
        }
        setBusy(!!state.key);
        if (state.key) {
            const pending = reconcileVisibility();
            const version = read.version;
            void pending.then((confirmed) => {
                if (version !== read.version) return;
                status.textContent = confirmed ? (state.report?.snapshot ? previewStatus() :
                    'This report is too large to review here. You can still hide or delete it.') :
                    'Could not confirm personal report visibility. Try opening this dialog again.';
            });
        }
    };
    button.addEventListener('click', open);
    manageButton.addEventListener('click', open);

    keyFile.addEventListener('change', async () => {
        const file = keyFile.files?.[0];
        keyFile.value = '';
        if (!file || file.size > 4096) return;
        const previous = { key: state.key, report: state.report, published: state.published, inAggregate: state.inAggregate };
        setBusy(true);
        try {
            const value: unknown = JSON.parse(await file.text());
            if (!value || typeof value !== 'object' || Array.isArray(value) ||
                Object.keys(value).sort().join() !== 'id,token' || !('id' in value) || !('token' in value) ||
                typeof value.id !== 'string' || typeof value.token !== 'string' ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id) ||
                !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new TypeError('Invalid private key.');
            state.key = { id: value.id, token: value.token };
            read.version++;
            state.published = null;
            state.inAggregate = null;
            state.report = null;
            const response = await fetch(`/api/contributions/${value.id}`, {
                headers: { Authorization: `Bearer ${value.token}` }, cache: 'no-store',
            });
            if (!response.ok) throw new TypeError('Invalid private key.');
            const saved = parseOwnedReport(await response.json(), value.id);
            state.report = saved;
            state.published = saved.published;
            state.inAggregate = saved.inAggregate;
            stored.textContent = saved.snapshot ? formatCounts(saved.snapshot) : '';
            stored.hidden = !saved.snapshot;
            showKey();
            status.textContent = !saved.snapshot ? 'This report is too large to review here. You can still hide or delete it.' :
                state.snapshot ? previewStatus() :
                    `Private key loaded in this tab. Review all ${saved.snapshot.weeks.length} stored weeks above before sharing. Your report is ${saved.published ? 'already public' : 'private'} and your counts are ${saved.inAggregate ? 'in the community aggregate' : 'outside the community aggregate'}.`;
            confirm.textContent = 'Replace these weeks';
        } catch {
            state.key = previous.key;
            state.report = previous.report;
            state.published = previous.published;
            state.inAggregate = previous.inAggregate;
            stored.textContent = previous.report?.snapshot ? formatCounts(previous.report.snapshot) : '';
            stored.hidden = !previous.report?.snapshot;
            result.hidden = !previous.key;
            showKey();
            status.textContent = previous.key
                ? 'Could not load that private key. Your previous contribution is still loaded.'
                : 'Could not load this private key or its contribution.';
        } finally { setBusy(false); }
    });

    confirm.addEventListener('click', async () => {
        if (!state.snapshot || (state.key && (state.published === null || state.inAggregate === null || state.report?.snapshot === null))) return;
        read.version++;
        setBusy(true);
        status.textContent = 'Compressing and uploading only the displayed weekly counts…';
        try {
            const { default: brotli } = await import('brotli-wasm');
            const encoder = await brotli;
            const compressed = encoder.compress(new TextEncoder().encode(JSON.stringify(state.snapshot)), { quality: 5 });
            const response = await fetch(state.key ? `/api/contributions/${state.key.id}` : '/api/contributions/personal', {
                method: state.key ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/vnd.model-tides.weekly+json',
                    'Content-Encoding': 'br',
                    'X-Model-Tides-Schema': 'weekly-v1',
                    ...(!state.key ? { 'X-Model-Tides-Report': 'personal-v1' } : {}),
                    ...(state.key ? { Authorization: `Bearer ${state.key.token}`,
                        'X-Model-Tides-Expected-Visibility': state.published ? 'public' : 'private',
                        'X-Model-Tides-Expected-Aggregate': state.inAggregate ? 'included' : 'excluded' } : {}),
                },
                body: new Blob([Uint8Array.from(compressed)]),
                cache: 'no-store',
            });
            if (!response.ok) throw new Error('Upload failed.');
            const saved: { id: string; token?: string; published?: boolean; inAggregate?: boolean } = await response.json();
            if (!state.key && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved?.id) &&
                typeof saved.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(saved.token) &&
                (saved.published !== true || saved.inAggregate !== false ||
                    (saved as { url?: string }).url !== `${location.origin}/u/${saved.id}`)) {
                await fetch(`/api/contributions/${saved.id}`, {
                    method: 'DELETE', headers: { Authorization: `Bearer ${saved.token}` }, cache: 'no-store',
                }).catch(() => {});
                throw new Error('Upload returned an unexpected report state.');
            }
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.id) ||
                (state.key && saved.id !== state.key.id) ||
                typeof saved.published !== 'boolean' || typeof saved.inAggregate !== 'boolean' ||
                (!state.key && (saved.published !== true || saved.inAggregate !== false ||
                    (saved as { url?: string }).url !== `${location.origin}/u/${saved.id}`)) ||
                (state.key && (saved.published !== state.published || saved.inAggregate !== state.inAggregate)) ||
                (!state.key && (typeof saved.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.token)))) {
                throw new Error('Invalid upload response.');
            }
            state.key = state.key ?? { id: saved.id, token: saved.token! };
            state.published = saved.published;
            state.inAggregate = saved.inAggregate;
            state.report = null;
            stored.textContent = '';
            stored.hidden = true;
            confirm.hidden = true;
            showKey();
            status.textContent = state.published
                ? 'Personal chart published. Anyone with the link can see these counts. Download your private key before closing this tab to manage it.'
                : 'Counts updated. Your personal report is hidden. Download your private key before closing this tab to manage it.';
            const pending = reconcileVisibility();
            const version = read.version;
            void pending.then((confirmed) => {
                if (version === read.version && !confirmed) status.textContent =
                    'Counts uploaded, but current report visibility cannot be checked. Download your key and reopen this dialog to retry.';
            });
            void refresh();
        } catch {
            if (state.key) {
                state.published = null;
                state.inAggregate = null;
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
        if (!state.key || state.published === null || (published && !state.report?.snapshot)) return;
        const reviewed = state.report;
        if (published && !window.confirm('Publish every stored week, model, and count displayed above at a public link?')) return;
        read.version++;
        setBusy(true);
        const rejected = { value: false };
        try {
            const response = await fetch(`/api/contributions/${state.key.id}/${published ? 'share' : 'unshare'}`, {
                method: 'POST', headers: { Authorization: `Bearer ${state.key.token}`,
                    ...(published ? { 'X-Model-Tides-Reviewed-Revision': String(reviewed!.revision) } : {}) }, cache: 'no-store',
            });
            if (!response.ok) { rejected.value = true; throw new Error('Sharing change failed.'); }
            const saved: { id: string; published: boolean; url?: string } = await response.json();
            if (saved.id !== state.key.id || saved.published !== published ||
                (published && saved.url !== `${location.origin}/u/${state.key.id}`)) {
                throw new Error('Invalid sharing response.');
            }
            state.published = published;
            state.report = reviewed ? { ...reviewed, published, revision: reviewed.revision + 1 } : null;
            showKey();
            status.textContent = !confirm.hidden && state.snapshot ? previewStatus() : published
                ? 'Personal report published. Anyone with the link can see these weekly counts.'
                : 'Personal report hidden. Aggregate participation is unchanged.';
        } catch {
            state.published = null;
            state.report = null;
            stored.textContent = '';
            stored.hidden = true;
            showKey();
            const confirmed = await reconcileVisibility();
            const currentReport = state.report as OwnedReport | null;
            const matchesReview = !published || (reviewed && currentReport &&
                currentReport.revision === reviewed.revision + 1 &&
                JSON.stringify(currentReport.snapshot) === JSON.stringify(reviewed.snapshot));
            status.textContent = confirmed ? (!rejected.value && matchesReview && state.published === published
                ? `Personal report is ${published ? 'public' : 'hidden'}. Review stored counts again before sharing.`
                : 'Sharing was not confirmed. The stored counts may have changed; review them again before sharing.') :
                'Could not confirm personal report visibility. Try opening this dialog again.';
        }
        finally { setBusy(false); }
    };
    share.addEventListener('click', () => { void setSharing(true); });
    unshare.addEventListener('click', () => { void setSharing(false); });
    const setAggregate = async (contribute: boolean): Promise<void> => {
        if (!state.key || state.inAggregate === null || (contribute && !state.report?.snapshot)) return;
        if (!window.confirm(contribute
            ? 'Add every stored week, model, and count displayed above to the community aggregate?'
            : 'Remove your counts from the community aggregate? Your personal chart stays available.')) return;
        read.version++;
        setBusy(true);
        const reviewed = state.report;
        try {
            const response = await fetch(`/api/contributions/${state.key.id}/${contribute ? 'contribute' : 'withdraw'}`, {
                method: 'POST', headers: { Authorization: `Bearer ${state.key.token}`,
                    ...(contribute ? { 'X-Model-Tides-Reviewed-Revision': String(reviewed!.revision) } : {}) },
                cache: 'no-store',
            });
            if (!response.ok) throw new Error('Aggregate change rejected.');
            const saved: { id: string; inAggregate: boolean } = await response.json();
            if (saved.id !== state.key.id || saved.inAggregate !== contribute) throw new Error('Invalid aggregate response.');
            state.inAggregate = contribute;
            state.report = reviewed ? { ...reviewed, inAggregate: contribute, revision: reviewed.revision + 1 } : null;
            showKey();
            status.textContent = contribute ? 'Counts added to the community aggregate.' :
                'Counts removed from the aggregate. Your personal chart remains available.';
            void refresh();
        } catch {
            state.inAggregate = null;
            state.report = null;
            showKey();
            const confirmed = await reconcileVisibility();
            status.textContent = confirmed ? 'Could not confirm the aggregate change. Review stored counts before retrying.' :
                'Aggregate state is unknown. Reopen this dialog before retrying.';
        } finally { setBusy(false); }
    };
    aggregate?.addEventListener('click', () => { void setAggregate(true); });
    withdraw?.addEventListener('click', () => { void setAggregate(false); });
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
            read.version++;
            status.textContent = 'Private key rotated. Download the new key now; the old file no longer works.';
        } catch { status.textContent = 'Could not rotate the private key. Try again.'; }
        finally { setBusy(false); }
    });
    remove.addEventListener('click', async () => {
        if (!state.key || !window.confirm('Permanently delete your personal chart and any aggregate contribution?')) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/contributions/${state.key.id}`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${state.key.token}` },
            });
            if (!response.ok) throw new Error('Deletion failed.');
            state.key = null;
            read.version++;
            state.report = null;
            state.published = false;
            state.inAggregate = false;
            stored.textContent = '';
            stored.hidden = true;
            result.hidden = true;
            status.textContent = 'Contribution deleted. Your imported history remains in this tab.';
            void refresh();
        } catch { status.textContent = 'Could not delete the contribution. Try again.'; }
        finally { setBusy(false); }
    });
    return { clearSnapshot() { state.snapshot = null; dialog.close(); } };
}
