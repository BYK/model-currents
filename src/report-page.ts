import './model-usage.css';
import './flow-svg/flow-svg.css';
import { setupFlowTimeline } from './flow-timeline';
import { renderFlowSvg } from './flow-svg/renderer';
import { getModelColor, OTHER_MODEL_COLOR } from './model-colors';
import { downloadBlob } from './download-image';
import { setupTheme } from './theme';
import { parsePublicReport } from './weekly-snapshot';

const DAY = 86_400_000;
const MAX_VISIBLE_MODELS = 6;
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The shared report needs a root element.');
const id = window.location.pathname.slice('/u/'.length);
root.innerHTML = `
    <main class="usage-app shared-report-app">
        <header class="masthead">
            <a class="wordmark" href="/" aria-label="Model Tides home">
                <svg class="wordmark-mark" viewBox="0 0 32 24" fill="none" aria-hidden="true"><path d="M1 7c4-4 8-4 12 0s8 4 12 0 6-3 7-2M1 16c4-4 8-4 12 0s8 4 12 0 6-3 7-2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
                <span>MODEL TIDES<span class="wordmark-dot">.</span></span>
            </a>
            <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme">Dark theme</button>
        </header>
        <section class="chart-card" aria-labelledby="chart-heading">
            <div class="chart-heading-row">
                <div><p class="eyebrow">THE FLOW OF ATTENTION</p><h1 id="chart-heading">Your model tide</h1></div>
                <div class="chart-actions"><span class="model-visibility" id="model-visibility"></span>
                    <button class="text-button" id="show-models" type="button" hidden></button></div>
            </div>
            <p id="report-status" class="report-status" role="status" aria-live="polite">Loading shared weekly counts…</p>
            <div class="legend" role="group" aria-label="Chart legend">
                <span class="legend-item"><i class="legend-line"></i>Bright marks = reported model uses</span>
                <span class="legend-item"><i class="legend-continuity"></i>Faint streams = recurring models</span>
                <span class="legend-item"><i class="legend-migration"></i>Crossing streams = inferred shifts</span>
                <span class="legend-item legend-note">Weekly counts cannot show tracked switches</span>
            </div>
            <div class="model-legend" id="model-legend" role="group" aria-label="Model colors"></div>
            <div class="chart-frame">
                <div class="chart-scroll" id="chart-scroll"><div class="chart-canvas" id="chart-canvas" role="img" aria-label="Your model tide over time"></div></div>
                <div class="chart-empty" id="chart-message" hidden></div>
            </div>
            <div class="timeline-controls" id="timeline-controls" hidden>
                <div class="timeline-head">
                    <div><p class="eyebrow">ADJUST THE WINDOW</p>
                        <p class="timeline-instruction">Scroll to zoom around the pointer; drag the chart to pan. Adjust dates below.</p></div>
                    <div class="timeline-head-actions">
                        <div class="date-pair"><span id="from-date">—</span><span class="date-arrow">→</span><span id="to-date">—</span></div>
                        <div class="zoom-actions" role="group" aria-label="Timeline zoom controls">
                            <button class="zoom-button" id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
                            <button class="zoom-button" id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
                            <button class="text-button" id="zoom-reset" type="button">Reset</button>
                        </div>
                    </div>
                </div>
                <div class="range-track"><span class="range-selection" id="range-selection"></span>
                    <input id="range-start" type="range" aria-label="Timeline start date" />
                    <input id="range-end" type="range" aria-label="Timeline end date" /></div>
                <div class="range-labels"><span id="range-min-label">—</span><span id="range-max-label">—</span></div>
            </div>
        </section>
        <div class="report-share" role="group" aria-label="Share this model tide">
            <button class="text-button" id="copy-report-image" type="button">Copy image</button>
            <button class="text-button" id="download-report-image" type="button">Download PNG</button>
            <button class="text-button" id="native-share-image" type="button" hidden>Share image…</button>
            <a id="share-x" target="_blank" rel="noopener noreferrer">Post on X ↗</a>
            <a id="share-bluesky" target="_blank" rel="noopener noreferrer">Post on Bluesky ↗</a>
            <span id="share-status" role="status" aria-live="polite"></span>
        </div>
        <footer class="report-footer"><p>Self-reported weekly model counts; no exact times or tracked switches. Crossing streams pair declines with rises in adjacent weeks (or months when zoomed out). They suggest apparent shifts, not a person's migration. Anyone with this link can view these counts.</p>
            <a href="/">Model Tides home</a> · <a href="https://github.com/BYK/model-tides" target="_blank" rel="noopener noreferrer">Source on GitHub ↗</a></footer>
    </main>`;
setupTheme(root);
const element = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!;
const status = element<HTMLElement>('#report-status');
const canvas = element<HTMLElement>('#chart-canvas');
const scroll = element<HTMLElement>('#chart-scroll');
const message = element<HTMLElement>('#chart-message');
const controls = element<HTMLElement>('#timeline-controls');
const visibility = element<HTMLElement>('#model-visibility');
const modelLegend = element<HTMLElement>('#model-legend');
const showModels = element<HTMLButtonElement>('#show-models');
const formatCount = (value: number): string => new Intl.NumberFormat('en-GB').format(value);
const formatDate = (date: Date, options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date);
const state = { rows: [] as { time: number; model: string; count: number }[],
    minDay: 0, maxDay: 1, startDay: 0, endDay: 1, showAll: false, width: 0, height: 0 };

function render(): void {
    if (!state.rows.length) return;
    const start = state.startDay * DAY;
    const end = (state.endDay + 1) * DAY - 1;
    const rows = state.rows.filter(({ time }) => time >= start && time <= end);
    const counts = new Map<string, number>();
    for (const { model, count } of rows) counts.set(model, (counts.get(model) ?? 0) + count);
    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const showAll = state.showAll || ranked.length <= MAX_VISIBLE_MODELS;
    const visible = showAll ? ranked.map(([model]) => model)
        : [...ranked.slice(0, MAX_VISIBLE_MODELS).map(([model]) => model), 'Other models'];
    const visibleSet = new Set(visible);
    const displayModel = (model: string): string => visibleSet.has(model) ? model : 'Other models';
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const displayDate = (day: number): string => formatDate(new Date(day * DAY), { day: 'numeric', month: 'short', year: 'numeric' });
    status.textContent = `${formatCount(total)} model uses · ${displayDate(state.startDay)} → ${displayDate(state.endDay)} · ${formatCount(ranked.length)} models`;
    visibility.textContent = ranked.length > MAX_VISIBLE_MODELS && !showAll
        ? `Top ${MAX_VISIBLE_MODELS} + other` : `${formatCount(ranked.length)} ${ranked.length === 1 ? 'model' : 'models'}`;
    showModels.hidden = ranked.length <= MAX_VISIBLE_MODELS;
    showModels.textContent = showAll ? 'Show top models' : `Show all ${formatCount(ranked.length)}`;
    showModels.setAttribute('aria-expanded', String(showAll));
    modelLegend.replaceChildren();
    for (const model of visible) {
        const item = document.createElement('span');
        item.className = 'model-legend-item';
        const swatch = document.createElement('i');
        swatch.className = 'model-legend-swatch';
        swatch.style.backgroundColor = model === 'Other models' ? OTHER_MODEL_COLOR : getModelColor(model);
        const label = document.createElement('span');
        label.textContent = model === 'Other models' ? model : model.replace('/', ' / ');
        item.append(swatch, label);
        modelLegend.append(item);
    }
    if (!rows.length) {
        canvas.replaceChildren();
        scroll.hidden = true;
        message.hidden = false;
        message.textContent = 'No model activity in this window. Widen the timeline to see more.';
        return;
    }
    scroll.hidden = false;
    message.hidden = true;
    canvas.innerHTML = renderFlowSvg(rows.map(({ time, model, count }) => ({ time, to: model, weight: count })), {
        start, end, width: state.width || scroll.clientWidth || 900, height: state.height || 520,
        weeklyBuckets: true, inferMigrations: true,
        order: visible, displayKey: displayModel,
        displayName: (model) => model === 'Other models' ? model : model.replace('/', ' / '),
        colorFor: (model) => model === 'Other models' ? OTHER_MODEL_COLOR : getModelColor(model),
        streamColorFor: (model) => getModelColor(model), formatValue: formatCount,
        formatPeriod: (time, intervalDays) => formatDate(new Date(time), intervalDays === 30
            ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
            : { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        formatNodeTitle: ({ period, label, value }) => `${period} · ${label} · ${formatCount(value)} self-reported model uses`,
        formatLinkTitle: ({ toLabel, toPeriod, value }) => `${formatCount(value)} self-reported uses of ${toLabel} in ${toPeriod}`,
        formatContinuityTitle: ({ label, fromPeriod, toPeriod }) =>
            `Visual continuity: ${label} has reported model uses in ${fromPeriod} and ${toPeriod}. Weekly counts do not track sessions between periods.`,
        axisCaption: 'EARLIER ← TIME → LATER', ariaLabel: 'Your self-reported model tide over time',
    });
}

const timeline = setupFlowTimeline({ canvas, scroll,
    start: element<HTMLInputElement>('#range-start'), end: element<HTMLInputElement>('#range-end'),
    selection: element<HTMLElement>('#range-selection'),
    fromDate: element<HTMLElement>('#from-date'), toDate: element<HTMLElement>('#to-date'),
    minLabel: element<HTMLElement>('#range-min-label'), maxLabel: element<HTMLElement>('#range-max-label'),
    zoomIn: element<HTMLButtonElement>('#zoom-in'), zoomOut: element<HTMLButtonElement>('#zoom-out'),
    zoomReset: element<HTMLButtonElement>('#zoom-reset'),
}, () => ({ minDay: state.minDay, maxDay: state.maxDay, startDay: state.startDay, endDay: state.endDay }),
(startDay, endDay) => { state.startDay = startDay; state.endDay = endDay; render(); });
showModels.addEventListener('click', () => { state.showAll = !state.showAll; render(); });

function resize(): void {
    const bounds = scroll.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const viewportWidth = Math.max(1, window.visualViewport?.width ?? window.innerWidth);
    const viewportHeight = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
    const width = Math.round(bounds.width);
    const height = Math.max(320, Math.round(Math.min(width * viewportHeight / viewportWidth * 0.66, viewportHeight * 0.78)));
    if (state.width === width && state.height === height) return;
    state.width = width;
    state.height = height;
    scroll.style.setProperty('--flow-chart-height', `${height}px`);
    render();
}
new ResizeObserver(resize).observe(scroll);
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

const reportUrl = `${window.location.origin}/u/${id}`;
const shareText = `Your model tide · ${reportUrl}`;
element<HTMLAnchorElement>('#share-x').href = `https://twitter.com/intent/tweet?${new URLSearchParams({ text: 'Your model tide', url: reportUrl })}`;
element<HTMLAnchorElement>('#share-bluesky').href = `https://bsky.app/intent/compose?${new URLSearchParams({ text: shareText })}`;
const shareStatus = element<HTMLElement>('#share-status');
const imageUrl = `/og/${id}.png`;
async function imageBlob(): Promise<Blob> {
    const response = await fetch(imageUrl, { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Image unavailable.');
    return response.blob();
}
const copyImage = element<HTMLButtonElement>('#copy-report-image');
copyImage.addEventListener('click', () => {
    copyImage.disabled = true;
    void (async () => {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob() })]);
        shareStatus.textContent = 'Image copied. Paste it into your post.';
    })().catch(() => { shareStatus.textContent = 'Could not copy the image in this browser. Download the PNG instead.'; })
        .finally(() => { copyImage.disabled = false; });
});
const downloadImage = element<HTMLButtonElement>('#download-report-image');
downloadImage.addEventListener('click', () => {
    downloadImage.disabled = true;
    void imageBlob().then((blob) => downloadBlob(blob, 'model-tides.png'))
        .catch(() => { shareStatus.textContent = 'Could not download the image.'; })
        .finally(() => { downloadImage.disabled = false; });
});
const nativeShare = element<HTMLButtonElement>('#native-share-image');
if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    nativeShare.hidden = false;
    nativeShare.addEventListener('click', () => {
        nativeShare.disabled = true;
        void (async () => {
            const file = new File([await imageBlob()], 'model-tides.png', { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'Your model tide', text: shareText, files: [file] });
            else await navigator.share({ title: 'Your model tide', text: shareText, url: reportUrl });
        })().catch(() => { shareStatus.textContent = 'Use Copy image or Download PNG to share the chart.'; })
            .finally(() => { nativeShare.disabled = false; });
    });
}

void (async () => {
    const response = await fetch(`/api/contributions/${id}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Report unavailable.');
    const snapshot = parsePublicReport(await response.json(), id);
    state.rows = snapshot.weeks.flatMap(({ week, models }) =>
        Object.entries(models).map(([model, count]) => ({ time: Date.parse(`${week}T00:00:00Z`), model, count })));
    if (!state.rows.length) throw new Error('Report unavailable.');
    const days = state.rows.map(({ time }) => Math.floor(time / DAY));
    state.minDay = Math.min(...days);
    state.maxDay = Math.max(state.minDay + 1, ...days);
    state.startDay = state.minDay;
    state.endDay = state.maxDay;
    controls.hidden = false;
    timeline.update();
    render();
})().catch(() => {
    controls.hidden = true;
    canvas.replaceChildren();
    scroll.hidden = true;
    message.hidden = false;
    message.textContent = 'This report is hidden or unavailable.';
    status.textContent = 'This report is hidden or unavailable.';
    element<HTMLElement>('.report-share').hidden = true;
});
