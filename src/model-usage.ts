import './model-usage.css';
import './flow-svg/flow-svg.css';
import exporterScript from '../scripts/export-model-tides.py?raw';
import historyExporterScript from '../scripts/export-history.py?raw';
import { makeDemoUsage } from './demo-usage';
import { renderFlowSvg } from './flow-svg/renderer';
import { getModelColor, OTHER_MODEL_COLOR } from './model-colors';
import { downloadBlob, downloadShareImage } from './share-image';
import { MAX_DATABASE_BYTES, MAX_JSON_BYTES, parseUsageDocument, type UsageDocument, type UsageEvent } from './usage-data';
import { clampEndDay, clampStartDay, panDateRange, zoomDateRange } from './timeline-zoom';

type ModelEvent = UsageEvent;

const DAY = 86_400_000;
const MAX_VISIBLE_MODELS = 6;
const root = document.querySelector<HTMLElement>('#app');

if (!root) {
    throw new Error('The model usage app needs a root element.');
}

root.innerHTML = `
    <main class="usage-app">
        <header class="masthead">
            <a class="wordmark" href="#" aria-label="Model Tides home">
                <svg class="wordmark-mark" viewBox="0 0 32 24" fill="none" aria-hidden="true"><path d="M1 7c4-4 8-4 12 0s8 4 12 0 6-3 7-2M1 16c4-4 8-4 12 0s8 4 12 0 6-3 7-2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
                <span>MODEL TIDES<span class="wordmark-dot">.</span></span>
            </a>
            <div class="masthead-actions">
                <div class="local-badge"><span class="status-dot"></span> PRIVATE · IN YOUR BROWSER</div>
                <a class="studio-link" href="#import-history">How to import <span aria-hidden="true">↓</span></a>
                <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme">Dark theme</button>
            </div>
        </header>

        <section class="intro">
            <div class="intro-copy">
                <p class="eyebrow">A CLEARER VIEW OF YOUR MODEL HISTORY</p>
                <h1>Model Tides<span class="title-wave" aria-hidden="true"> ~</span></h1>
                <p class="dek">Your models, over time.</p>
            </div>
            <button class="refresh-button" id="import-top" type="button">Open my history</button>
        </section>

        <section class="import-card" id="import-history" aria-label="Import model history">
            <div>
                <p class="eyebrow">BRING YOUR OWN DATA</p>
                <h2>Open a database or a metadata file</h2>
                <p>Choose an OpenCode <code>opencode.db</code> (usually <code>~/.local/share/opencode/opencode.db</code>), or a Model Tides JSON file from any harness. Older Model Currents JSON works too. Nothing is uploaded or saved here. You can also drop a file on this card.</p>
                <p class="import-note">For large databases or recent changes held in a <code>-wal</code> file, <button class="inline-link" id="download-exporter" type="button">download the local exporter</button>. In its folder, run <code>python3 export-model-tides.py &gt; model-tides.json</code> and open the JSON here.</p>
                <p class="import-note">For Codex or Claude Code, <button class="inline-link" id="download-history-exporter" type="button">download the history converter</button>. Run <code>python3 export-history.py codex &gt; model-tides.json</code> or replace <code>codex</code> with <code>claude-code</code>, then open the JSON here. Older compressed Codex histories need <code>zstd</code> installed locally.</p>
            </div>
            <div class="import-actions">
                <input id="history-file" type="file" accept=".db,.sqlite,.sqlite3,.json,application/json" hidden />
                <button class="import-button" id="choose-history" type="button">Choose a file</button>
                <button class="text-button" id="try-example" type="button">Use mock data</button>
                <span id="import-status" role="status" aria-live="polite">No file selected</span>
            </div>
        </section>

        <section class="summary-grid" aria-label="Usage summary">
            <article class="summary-card summary-card--accent">
                <span class="summary-label">TOTAL MODEL USAGE</span>
                <strong class="summary-value" id="usage-total">—</strong>
                <span class="summary-foot" id="usage-caption">sessions + model changes</span>
            </article>
            <article class="summary-card">
                <span class="summary-label">MODELS IN FLOW</span>
                <strong class="summary-value" id="model-total">—</strong>
                <span class="summary-foot" id="model-caption">top models + others</span>
            </article>
            <article class="summary-card summary-card--range">
                <span class="summary-label">TIME SPAN</span>
                <strong class="summary-value summary-range" id="range-summary">Loading history</strong>
                <span class="summary-foot" id="event-total">Counting model assignments</span>
            </article>
        </section>

        <section class="chart-card" aria-labelledby="chart-heading">
            <div class="chart-heading-row">
                <div>
                    <p class="eyebrow">THE FLOW OF ATTENTION</p>
                    <h2 id="chart-heading">Model flow over time</h2>
                </div>
                <div class="chart-actions">
                    <span class="model-visibility" id="model-visibility"></span>
                    <button class="text-button" id="show-models" type="button" hidden></button>
                    <button class="text-button" id="share-image" type="button" hidden>Download share image</button>
                    <button class="text-button" id="export-metadata" type="button" hidden>Export metadata JSON</button>
                    <button class="text-button" id="clear-history" type="button" hidden>Clear history</button>
                </div>
            </div>

            <div class="legend" id="chart-legend" role="group" aria-label="Chart legend">
                <span class="legend-item"><i class="legend-line"></i>Bright ribbons = observed starts and switches</span>
                <span class="legend-item"><i class="legend-continuity"></i>Faint streams = same model, resized per period</span>
                <span class="legend-item legend-note">One event per new session or model change</span>
            </div>
            <div class="model-legend" id="model-legend" role="group" aria-label="Model colors"></div>

            <div class="chart-frame" id="chart-frame">
                <div class="chart-scroll" id="chart-scroll">
                    <div class="chart-canvas" id="chart-canvas" role="img" aria-label="Chronological model usage flow over time"></div>
                </div>
                <div class="chart-empty" id="chart-message" hidden></div>
            </div>

            <div class="timeline-controls" id="timeline-controls" hidden>
                <div class="timeline-head">
                    <div>
                        <p class="eyebrow">ADJUST THE WINDOW</p>
                        <p class="timeline-instruction">Scroll to zoom around the pointer; drag the chart to pan. Adjust dates below.</p>
                    </div>
                    <div class="timeline-head-actions">
                        <div class="date-pair"><span id="from-date">—</span><span class="date-arrow">→</span><span id="to-date">—</span></div>
                        <div class="zoom-actions" role="group" aria-label="Timeline zoom controls">
                            <button class="zoom-button" id="zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button>
                            <button class="zoom-button" id="zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button>
                            <button class="text-button" id="zoom-reset" type="button">Reset</button>
                        </div>
                    </div>
                </div>
                <div class="range-track" id="range-track">
                    <span class="range-selection" id="range-selection"></span>
                    <input id="range-start" type="range" aria-label="Timeline start date" />
                    <input id="range-end" type="range" aria-label="Timeline end date" />
                </div>
                <div class="range-labels"><span id="range-min-label">—</span><span id="range-max-label">—</span></div>
            </div>
        </section>

        <footer class="footnote">
            <span class="footnote-mark">i</span>
            <p id="footnote-copy">New sessions and model changes count as one observed usage event; repeated turns on the same model add nothing. Bright ribbons show recorded events, including within-period model switches. Faint streams connect recurring models and resize between each period’s activity; they show visual continuity, not persistent sessions. OpenCode database queries read model and timestamp metadata, plus session IDs to count starts; IDs never leave the browser. Local history converters use IDs only to avoid double-counting; IDs never enter JSON. Prompts and responses are never extracted. No imported data is sent or stored.</p>
            <span class="source-label"><span class="status-dot"></span> ON-DEVICE ANALYSIS</span>
            <a class="repo-link" href="https://github.com/BYK/model-tides" target="_blank" rel="noopener noreferrer">Source on GitHub ↗</a>
        </footer>
    </main>
`;

const usageTotal = root.querySelector<HTMLElement>('#usage-total')!;
const usageCaption = root.querySelector<HTMLElement>('#usage-caption')!;
const modelTotal = root.querySelector<HTMLElement>('#model-total')!;
const modelCaption = root.querySelector<HTMLElement>('#model-caption')!;
const rangeSummary = root.querySelector<HTMLElement>('#range-summary')!;
const eventTotal = root.querySelector<HTMLElement>('#event-total')!;
const chartCanvas = root.querySelector<HTMLElement>('#chart-canvas')!;
const chartMessage = root.querySelector<HTMLElement>('#chart-message')!;
const timelineControls = root.querySelector<HTMLElement>('#timeline-controls')!;
const fromDateLabel = root.querySelector<HTMLElement>('#from-date')!;
const toDateLabel = root.querySelector<HTMLElement>('#to-date')!;
const rangeMinLabel = root.querySelector<HTMLElement>('#range-min-label')!;
const rangeMaxLabel = root.querySelector<HTMLElement>('#range-max-label')!;
const rangeStart = root.querySelector<HTMLInputElement>('#range-start')!;
const rangeEnd = root.querySelector<HTMLInputElement>('#range-end')!;
const rangeSelection = root.querySelector<HTMLElement>('#range-selection')!;
const chartScroll = root.querySelector<HTMLElement>('#chart-scroll')!;
const zoomInButton = root.querySelector<HTMLButtonElement>('#zoom-in')!;
const zoomOutButton = root.querySelector<HTMLButtonElement>('#zoom-out')!;
const zoomResetButton = root.querySelector<HTMLButtonElement>('#zoom-reset')!;
const modelVisibility = root.querySelector<HTMLElement>('#model-visibility')!;
const modelLegend = root.querySelector<HTMLElement>('#model-legend')!;
const showModelsButton = root.querySelector<HTMLButtonElement>('#show-models')!;
const historyFile = root.querySelector<HTMLInputElement>('#history-file')!;
const importTopButton = root.querySelector<HTMLButtonElement>('#import-top')!;
const chooseHistoryButton = root.querySelector<HTMLButtonElement>('#choose-history')!;
const exampleButton = root.querySelector<HTMLButtonElement>('#try-example')!;
const themeToggleButton = root.querySelector<HTMLButtonElement>('#theme-toggle')!;
const downloadExporterButton = root.querySelector<HTMLButtonElement>('#download-exporter')!;
const downloadHistoryExporterButton = root.querySelector<HTMLButtonElement>('#download-history-exporter')!;
const importCard = root.querySelector<HTMLElement>('#import-history')!;
const importStatus = root.querySelector<HTMLElement>('#import-status')!;
const shareImageButton = root.querySelector<HTMLButtonElement>('#share-image')!;
const exportMetadataButton = root.querySelector<HTMLButtonElement>('#export-metadata')!;
const clearHistoryButton = root.querySelector<HTMLButtonElement>('#clear-history')!;

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

function updateThemeToggle(): void {
    const isDark = document.documentElement.dataset.theme === 'dark' ||
        (document.documentElement.dataset.theme !== 'light' && systemTheme.matches);
    themeToggleButton.textContent = isDark ? 'Light theme' : 'Dark theme';
    themeToggleButton.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = isDark ? '#102832' : '#eef6f5';
}

themeToggleButton.addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && systemTheme.matches) ? 'light' : 'dark';
    updateThemeToggle();
});
systemTheme.addEventListener('change', updateThemeToggle);
updateThemeToggle();

const state: {
    events: ModelEvent[];
    minDay: number;
    maxDay: number;
    startDay: number;
    endDay: number;
    chartWidth: number;
    chartHeight: number;
    showAll: boolean;
    loading: boolean;
    document: UsageDocument | null;
} = {
    events: [],
    minDay: 0,
    maxDay: 1,
    startDay: 0,
    endDay: 0,
    chartWidth: 0,
    chartHeight: 0,
    showAll: false,
    loading: false,
    document: null,
};

const formatCount = (value: number) => new Intl.NumberFormat('en-GB').format(value);
const dateFromDay = (day: number) => new Date(day * DAY);
const formatDate = (date: Date, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    new Intl.DateTimeFormat('en-GB', options).format(date);
const modelProvider = (model: string) => model.split('/')[0] ?? model;
const modelName = (model: string) => model.slice(model.indexOf('/') + 1);

function activeRange(): { start: number; end: number; events: ModelEvent[] } {
    const start = state.startDay * DAY;
    const end = (state.endDay + 1) * DAY - 1;
    return { start, end, events: state.events.filter((event) => event.time >= start && event.time <= end) };
}

function updateRangeControls(minDay: number, maxDay: number): void {
    rangeStart.min = String(minDay);
    rangeStart.max = String(maxDay);
    rangeEnd.min = String(minDay);
    rangeEnd.max = String(maxDay);

    rangeStart.value = String(state.startDay);
    rangeEnd.value = String(state.endDay);

    const span = Math.max(1, maxDay - minDay);
    const left = ((state.startDay - minDay) / span) * 100;
    const right = ((state.endDay - minDay) / span) * 100;
    rangeSelection.style.left = `${left}%`;
    rangeSelection.style.width = `${right - left}%`;

    fromDateLabel.textContent = formatDate(dateFromDay(state.startDay));
    toDateLabel.textContent = formatDate(dateFromDay(state.endDay));
    rangeMinLabel.textContent = formatDate(dateFromDay(minDay), { month: 'short', year: 'numeric' });
    rangeMaxLabel.textContent = formatDate(dateFromDay(maxDay), { month: 'short', year: 'numeric' });
    const selectedDays = state.endDay - state.startDay + 1;
    const availableDays = maxDay - minDay + 1;
    chartScroll.classList.toggle('is-pannable', selectedDays < availableDays);
    zoomInButton.disabled = selectedDays <= 2;
    zoomOutButton.disabled = selectedDays >= availableDays;
    zoomResetButton.hidden = selectedDays >= availableDays;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
let activePan: {
    pointerId: number;
    startX: number;
    startY: number;
    startDay: number;
    endDay: number;
    plotWidth: number;
    viewBoxWidth: number;
    clientWidth: number;
    moved: boolean;
} | null = null;

function chartPlotGeometry(): {
    bounds: DOMRect;
    width: number;
    firstX: number;
    lastX: number;
    firstPeriod: number;
    lastPeriod: number;
} | null {
    const svg = chartCanvas.querySelector<SVGSVGElement>('svg.flow-svg');
    const bounds = svg?.getBoundingClientRect();
    if (!svg || !bounds || bounds.width <= 0) return null;

    const geometry = {
        bounds,
        width: svg.viewBox.baseVal.width || state.chartWidth,
        firstX: Number(svg.dataset.flowPlotStartX),
        lastX: Number(svg.dataset.flowPlotEndX),
        firstPeriod: Number(svg.dataset.flowPlotStartTime),
        lastPeriod: Number(svg.dataset.flowPlotEndTime),
    };
    return Object.values(geometry).slice(1).every(Number.isFinite) ? geometry : null;
}

function setVisibleRange(startDay: number, endDay: number): void {
    state.startDay = startDay;
    state.endDay = endDay;
    updateRangeControls(state.minDay, state.maxDay);
    renderChart();
}

function zoomRange(factor: number, anchorDay?: number, anchorPosition?: number): boolean {
    if (state.events.length === 0) return false;
    const next = zoomDateRange({
        minDay: state.minDay,
        maxDay: state.maxDay,
        startDay: state.startDay,
        endDay: state.endDay,
    }, factor, anchorDay === undefined && anchorPosition === undefined
        ? undefined
        : { day: anchorDay ?? (state.startDay + state.endDay) / 2, position: anchorPosition ?? 0.5 });
    if (!next) return false;
    setVisibleRange(next.startDay, next.endDay);
    return true;
}

function dateAtChartPosition(clientX: number): { day: number; position: number } {
    const geometry = chartPlotGeometry();
    if (!geometry) {
        return { day: (state.startDay + state.endDay) / 2, position: 0.5 };
    }
    const { bounds, width, firstX, lastX, firstPeriod, lastPeriod } = geometry;
    if (firstPeriod === lastPeriod) return { day: (state.startDay + state.endDay) / 2, position: 0.5 };

    const x = ((clientX - bounds.left) / bounds.width) * width;
    const fraction = clamp((x - firstX) / Math.max(1, lastX - firstX), 0, 1);
    return {
        day: clamp((firstPeriod + fraction * (lastPeriod - firstPeriod)) / DAY, state.startDay, state.endDay),
        position: fraction,
    };
}

function zoomWithWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * chartScroll.clientHeight
            : event.deltaY;
    const steps = clamp(delta / 100, -4, 4);
    const anchor = dateAtChartPosition(event.clientX);
    if (zoomRange(Math.pow(1.2, steps), anchor.day, anchor.position)) event.preventDefault();
}

function startChartPan(event: PointerEvent): void {
    if (event.button !== 0 || state.events.length === 0) return;
    const geometry = chartPlotGeometry();
    const selectedDays = state.endDay - state.startDay + 1;
    if (!geometry || geometry.lastX <= geometry.firstX || selectedDays >= state.maxDay - state.minDay + 1) return;

    activePan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startDay: state.startDay,
        endDay: state.endDay,
        plotWidth: geometry.lastX - geometry.firstX,
        viewBoxWidth: geometry.width,
        clientWidth: geometry.bounds.width,
        moved: false,
    };
    chartScroll.setPointerCapture(event.pointerId);
}

function moveChartPan(event: PointerEvent): void {
    if (!activePan || event.pointerId !== activePan.pointerId) return;
    const deltaX = event.clientX - activePan.startX;
    const deltaY = event.clientY - activePan.startY;
    if (!activePan.moved && Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;
    if (!activePan.moved && Math.abs(deltaY) > Math.abs(deltaX)) {
        activePan = null;
        if (chartScroll.hasPointerCapture(event.pointerId)) chartScroll.releasePointerCapture(event.pointerId);
        return;
    }

    activePan.moved = true;
    chartScroll.classList.add('is-panning');
    event.preventDefault();
    const spanDays = activePan.endDay - activePan.startDay;
    const deltaViewBox = deltaX * activePan.viewBoxWidth / activePan.clientWidth;
    const dayOffset = -deltaViewBox / activePan.plotWidth * spanDays;
    const next = panDateRange({
        minDay: state.minDay,
        maxDay: state.maxDay,
        startDay: activePan.startDay,
        endDay: activePan.endDay,
    }, dayOffset);
    if (next && (next.startDay !== state.startDay || next.endDay !== state.endDay)) {
        setVisibleRange(next.startDay, next.endDay);
    }
}

function endChartPan(event: PointerEvent): void {
    if (!activePan || event.pointerId !== activePan.pointerId) return;
    activePan = null;
    chartScroll.classList.remove('is-panning');
    if (chartScroll.hasPointerCapture(event.pointerId)) chartScroll.releasePointerCapture(event.pointerId);
}

function renderChart(): void {
    shareImageButton.hidden = !state.events.length;
    exportMetadataButton.hidden = state.document === null;
    clearHistoryButton.hidden = state.document === null;
    if (!state.document) {
        usageTotal.textContent = '—';
        modelTotal.textContent = '—';
        rangeSummary.textContent = 'Open a file';
        eventTotal.textContent = 'No data loaded';
        modelVisibility.textContent = '';
        showModelsButton.hidden = true;
        modelLegend.replaceChildren();
        chartMessage.hidden = false;
        chartMessage.textContent = 'Choose a database, open a metadata JSON file, or try the invented example.';
        chartCanvas.replaceChildren();
        chartScroll.hidden = true;
        timelineControls.hidden = true;
        return;
    }
    const { start, end, events } = activeRange();
    const modelCounts = new Map<string, number>();
    const sourceModels = new Set<string>();
    for (const event of events) {
        modelCounts.set(event.model, (modelCounts.get(event.model) ?? 0) + 1);
        if (event.kind === 'switch' && event.fromModel && event.fromTime !== undefined && event.fromTime >= start) {
            sourceModels.add(event.fromModel);
        }
    }
    for (const model of sourceModels) {
        if (!modelCounts.has(model)) {
            modelCounts.set(model, 0);
        }
    }

    const rankedModels = [...modelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const showAll = state.showAll || rankedModels.length <= MAX_VISIBLE_MODELS;
    const visibleModels = showAll ? rankedModels.map(([model]) => model) : [...rankedModels.slice(0, MAX_VISIBLE_MODELS).map(([model]) => model), 'Other models'];
    const visibleSet = new Set(visibleModels);
    const modelColors = new Map(visibleModels.map((model) => [
        model,
        model === 'Other models' ? OTHER_MODEL_COLOR : getModelColor(model),
    ]));
    const displayModel = (model: string) => (visibleSet.has(model) ? model : 'Other models');

    usageTotal.textContent = formatCount(events.length);
    usageCaption.textContent = 'session starts + model changes';
    modelTotal.textContent = formatCount(visibleModels.length);
    modelCaption.textContent = rankedModels.length > MAX_VISIBLE_MODELS && !showAll
        ? `top ${MAX_VISIBLE_MODELS} + other models`
        : 'provider and model';
    eventTotal.textContent = `${formatCount(events.length)} combined usage events`;
    rangeSummary.textContent = state.events.length
        ? `${formatDate(dateFromDay(state.startDay), { month: 'short', year: 'numeric' })} — ${formatDate(dateFromDay(state.endDay), { month: 'short', year: 'numeric' })}`
        : 'No events';
    modelVisibility.textContent = rankedModels.length > MAX_VISIBLE_MODELS && !showAll
        ? `Top ${MAX_VISIBLE_MODELS} + other`
        : `${formatCount(rankedModels.length)} ${rankedModels.length === 1 ? 'model' : 'models'}`;
    showModelsButton.hidden = rankedModels.length <= MAX_VISIBLE_MODELS;
    showModelsButton.textContent = showAll ? 'Show top models' : `Show all ${formatCount(rankedModels.length)}`;
    showModelsButton.setAttribute('aria-expanded', String(showAll));
    modelLegend.replaceChildren();
    for (const model of visibleModels) {
        const item = document.createElement('span');
        item.className = 'model-legend-item';
        const swatch = document.createElement('i');
        swatch.className = 'model-legend-swatch';
        swatch.style.backgroundColor = modelColors.get(model) ?? OTHER_MODEL_COLOR;
        const label = document.createElement('span');
        label.textContent = model === 'Other models' ? model : `${modelProvider(model)} / ${modelName(model)}`;
        item.append(swatch, label);
        modelLegend.append(item);
    }

    if (!events.length || !visibleModels.length) {
        chartCanvas.style.width = '';
        chartCanvas.style.height = '';
        chartMessage.hidden = false;
        chartMessage.textContent = state.events.length ? 'No model activity in this window. Widen the timeline to see more.' : 'No model assignments found in this file.';
        chartCanvas.style.display = 'none';
        chartScroll.hidden = true;
        chartCanvas.replaceChildren();
        return;
    }

    chartCanvas.style.display = '';
    chartMessage.hidden = true;
    chartCanvas.style.width = '';
    chartCanvas.style.height = '';
    chartCanvas.setAttribute('aria-label', 'Chronological model usage flow over time');

    chartScroll.hidden = false;
    chartCanvas.innerHTML = renderFlowSvg(events.map((event) => ({
        time: event.time,
        to: event.model,
        from: event.kind === 'switch' ? event.fromModel : undefined,
        fromTime: event.fromTime,
        weight: 1,
    })), {
        start,
        end,
        width: state.chartWidth || chartScroll.clientWidth || 900,
        height: state.chartHeight || 520,
        order: visibleModels,
        displayKey: displayModel,
        displayName: (model) => model === 'Other models' ? model : `${modelProvider(model)} / ${modelName(model)}`,
        colorFor: (model) => modelColors.get(model) ?? OTHER_MODEL_COLOR,
        streamColorFor: (model, _displayKey) => getModelColor(model),
        formatValue: formatCount,
        formatPeriod: (time, intervalDays) => formatDate(new Date(time), intervalDays === 30
            ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
            : { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        formatNodeTitle: ({ period, label, value }) => `${period} · ${label} · ${formatCount(value)} usage events`,
        formatLinkTitle: (link) => link.kind === 'entry'
            ? `${formatCount(link.value)} session starts or switches from before this window into ${link.toLabel} (${link.toPeriod})`
            : link.kind === 'intra-period'
                ? `${formatCount(link.value)} model switches within ${link.toPeriod}: ${link.fromLabel} to ${link.toLabel}`
                : `${formatCount(link.value)} model switches: ${link.fromLabel} (${link.fromPeriod}) to ${link.toLabel} (${link.toPeriod})`,
        formatContinuityTitle: ({ label, fromPeriod, toPeriod, movedEntryTitle }) =>
            `Visual continuity: ${label} had usage events in both ${fromPeriod} and ${toPeriod}. The snapshots do not track individual sessions between periods.${movedEntryTitle ? ` ${movedEntryTitle}.` : ''}`,
        axisCaption: 'EARLIER ← TIME → LATER',
        ariaLabel: 'Chronological model usage flow over time',
    });
    return;

}

function showDocument(document: UsageDocument): void {
    state.document = document;
    state.events = document.events;
    state.showAll = false;
    if (state.events.length) {
        const days = state.events.map((event) => Math.floor(event.time / DAY));
        state.minDay = days.reduce((minimum, day) => Math.min(minimum, day), Number.POSITIVE_INFINITY);
        state.maxDay = Math.max(state.minDay + 1, days.reduce((maximum, day) => Math.max(maximum, day), Number.NEGATIVE_INFINITY));
        state.startDay = state.minDay;
        state.endDay = state.maxDay;
        timelineControls.hidden = false;
        updateRangeControls(state.minDay, state.maxDay);
    } else {
        state.startDay = 0;
        state.endDay = 0;
        timelineControls.hidden = true;
    }
    renderChart();
}

function readDatabase(file: File): Promise<UsageDocument> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./opencode-db.worker.ts', import.meta.url), { type: 'module' });
        const stop = () => { window.clearTimeout(timeout); worker.terminate(); };
        const timeout = window.setTimeout(() => {
            stop();
            reject(new Error('Reading the database took too long. Use the local export script.'));
        }, 120_000);
        worker.onmessage = (event: MessageEvent<unknown>) => {
            stop();
            const result = event.data;
            if (result && typeof result === 'object' && 'ok' in result && result.ok === true &&
                'document' in result) {
                try { resolve(parseUsageDocument(result.document)); } catch { reject(new Error('The database returned invalid model metadata.')); }
            } else {
                reject(new Error('Could not read this database in the browser. Try the local export script.'));
            }
        };
        worker.onerror = () => {
            stop();
            reject(new Error('Could not start the offline database reader. Try the local export script.'));
        };
        worker.postMessage(file);
    });
}

async function loadFile(file: File): Promise<void> {
    if (state.loading) return;
    state.loading = true;
    chooseHistoryButton.disabled = true;
    importTopButton.disabled = true;
    exampleButton.disabled = true;
    importStatus.textContent = 'Reading model and timestamp metadata in your browser…';
    try {
        const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
        const maxBytes = isJson ? MAX_JSON_BYTES : MAX_DATABASE_BYTES;
        if (!file.size || file.size > maxBytes) throw new Error(
            isJson ? 'Choose a metadata JSON file under 32 MB.' : 'Choose a database under 256 MB, or use the local export script.',
        );
        const document = isJson ? parseUsageDocument(JSON.parse(await file.text()) as unknown) : await readDatabase(file);
        showDocument(document);
        importStatus.textContent = `${formatCount(document.events.length)} events loaded from ${document.source}. Data stays in this tab.${isJson ? '' : ' For recent WAL changes, use the local export script.'}`;
    } catch (error) {
        importStatus.textContent = error instanceof SyntaxError || error instanceof TypeError
            ? 'Invalid metadata file. Use a Model Tides v1 JSON file, or choose an OpenCode .db file.'
            : error instanceof Error ? error.message : 'Could not open this file.';
    } finally {
        state.loading = false;
        chooseHistoryButton.disabled = false;
        importTopButton.disabled = false;
        exampleButton.disabled = false;
        historyFile.value = '';
    }
}

rangeStart.addEventListener('input', () => {
    state.startDay = clampStartDay(Number(rangeStart.value), state.minDay, state.endDay);
    updateRangeControls(state.minDay, state.maxDay);
    renderChart();
});

rangeEnd.addEventListener('input', () => {
    state.endDay = clampEndDay(Number(rangeEnd.value), state.startDay, state.maxDay);
    updateRangeControls(state.minDay, state.maxDay);
    renderChart();
});

chartScroll.addEventListener('wheel', zoomWithWheel, { passive: false });
chartScroll.addEventListener('pointerdown', startChartPan);
chartScroll.addEventListener('pointermove', moveChartPan);
chartScroll.addEventListener('pointerup', endChartPan);
chartScroll.addEventListener('pointercancel', endChartPan);
chartScroll.addEventListener('lostpointercapture', endChartPan);
zoomInButton.addEventListener('click', () => { zoomRange(1 / 1.2); });
zoomOutButton.addEventListener('click', () => { zoomRange(1.2); });
zoomResetButton.addEventListener('click', () => setVisibleRange(state.minDay, state.maxDay));

showModelsButton.addEventListener('click', () => {
    state.showAll = !state.showAll;
    renderChart();
});

importTopButton.addEventListener('click', () => historyFile.click());
chooseHistoryButton.addEventListener('click', () => historyFile.click());
historyFile.addEventListener('change', () => { if (historyFile.files?.[0]) void loadFile(historyFile.files[0]); });
importCard.addEventListener('dragover', (event) => { event.preventDefault(); importCard.classList.add('is-dragging'); });
importCard.addEventListener('dragleave', () => importCard.classList.remove('is-dragging'));
importCard.addEventListener('drop', (event) => {
    event.preventDefault();
    importCard.classList.remove('is-dragging');
    if (event.dataTransfer?.files[0]) void loadFile(event.dataTransfer.files[0]);
});
exampleButton.addEventListener('click', () => {
    if (state.loading) return;
    const document = makeDemoUsage();
    showDocument(document);
    importStatus.textContent = 'Invented example loaded. This is not your usage history.';
});
downloadExporterButton.addEventListener('click', () => {
    downloadBlob(new Blob([exporterScript], { type: 'text/x-python' }), 'export-model-tides.py');
});
downloadHistoryExporterButton.addEventListener('click', () => {
    downloadBlob(new Blob([historyExporterScript], { type: 'text/x-python' }), 'export-history.py');
});
clearHistoryButton.addEventListener('click', () => {
    state.document = null;
    state.events = [];
    state.showAll = false;
    importStatus.textContent = 'History cleared from this tab.';
    renderChart();
});
exportMetadataButton.addEventListener('click', () => {
    if (state.document) downloadBlob(new Blob([JSON.stringify(state.document)], { type: 'application/json' }), 'model-tides.json');
});
shareImageButton.addEventListener('click', () => {
    const svg = chartCanvas.querySelector<SVGSVGElement>('svg.flow-svg');
    if (!svg || !state.document) return;
    shareImageButton.disabled = true;
    void downloadShareImage(svg, usageTotal.textContent ?? '', `${fromDateLabel.textContent} — ${toDateLabel.textContent}`, state.document.source)
        .catch(() => { importStatus.textContent = 'Could not create the share image in this browser.'; })
        .finally(() => { shareImageButton.disabled = false; });
});

function resizeChartCanvas(): void {
    const bounds = chartScroll.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const viewportWidth = Math.max(1, window.visualViewport?.width ?? window.innerWidth);
    const viewportHeight = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
    const width = Math.round(bounds.width);
    const height = Math.max(320, Math.round(Math.min(width * viewportHeight / viewportWidth * 0.66, viewportHeight * 0.78)));
    if (state.chartWidth === width && state.chartHeight === height) return;
    state.chartWidth = width;
    state.chartHeight = height;
    chartScroll.style.setProperty('--flow-chart-height', `${height}px`);
    renderChart();
}

const chartResizeObserver = new ResizeObserver(resizeChartCanvas);
chartResizeObserver.observe(chartScroll);
window.addEventListener('resize', resizeChartCanvas);
window.visualViewport?.addEventListener('resize', resizeChartCanvas);
resizeChartCanvas();
renderChart();
