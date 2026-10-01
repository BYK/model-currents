import { renderFlowSvg } from './flow-svg/renderer';
import { getModelColor } from './model-colors';

interface AggregateRow {
    readonly week: string;
    readonly model: string;
    readonly count: number;
    readonly contributors: number;
}

const exampleRows: AggregateRow[] = [
    { week: '2026-02-02', model: 'openai/gpt-5', count: 8, contributors: 5 },
    { week: '2026-02-09', model: 'openai/gpt-5', count: 5, contributors: 5 },
    { week: '2026-02-09', model: 'anthropic/claude-sonnet-4-5', count: 3, contributors: 5 },
    { week: '2026-02-16', model: 'openai/gpt-5', count: 4, contributors: 5 },
    { week: '2026-02-16', model: 'anthropic/claude-sonnet-4-5', count: 6, contributors: 5 },
    { week: '2026-02-23', model: 'anthropic/claude-sonnet-4-5', count: 9, contributors: 5 },
    { week: '2026-03-02', model: 'openai/gpt-5', count: 6, contributors: 5 },
    { week: '2026-03-02', model: 'anthropic/claude-sonnet-4-5', count: 5, contributors: 5 },
    { week: '2026-03-09', model: 'openai/gpt-5', count: 10, contributors: 5 },
    { week: '2026-03-09', model: 'anthropic/claude-sonnet-4-5', count: 4, contributors: 5 },
];

function renderRows(chart: HTMLElement, rows: AggregateRow[], example: boolean): void {
    const totals = new Map<string, number>();
    for (const { model, count } of rows) totals.set(model, (totals.get(model) ?? 0) + count);
    const ordered = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const visible = new Set(ordered.slice(0, 6).map(([model]) => model));
    const times = rows.map(({ week }) => Date.parse(`${week}T00:00:00Z`));
    const first = Math.min(...times);
    const last = Math.max(...times) + 6 * 86_400_000;
    chart.innerHTML = renderFlowSvg(rows.map(({ week, model, count }) => ({
        time: Date.parse(`${week}T00:00:00Z`), to: model, weight: count,
    })), {
        start: first, end: last, width: 1100, height: 400,
        order: [...visible, 'Other models'],
        displayKey: (model) => visible.has(model) ? model : 'Other models',
        colorFor: getModelColor,
        streamColorFor: (model) => getModelColor(model),
        formatValue: (value) => `${value.toLocaleString('en-GB')} ${example ? 'mock' : 'shared'} uses`,
        formatNodeTitle: ({ label, period, value }) => `${label} · ${period}\n${value.toLocaleString('en-GB')} ${example ? 'mock' : 'self-reported'} uses`,
        formatLinkTitle: ({ toLabel, toPeriod, value }) => `${toLabel} · ${toPeriod}\n${value.toLocaleString('en-GB')} ${example ? 'mock' : 'self-reported'} uses`,
        formatContinuityTitle: ({ label, fromPeriod, toPeriod }) => `${label}: appears in ${fromPeriod} and ${toPeriod}. This does not track people between periods.`,
        axisCaption: example ? 'EARLIER ← EXAMPLE MODEL COUNTS → LATER' : 'EARLIER ← REPORTED MODEL COUNTS → LATER',
        ariaLabel: example ? 'Mock example of weekly model counts' : 'Self-reported model counts by week, grouped into wider periods over longer histories',
    });
    chart.setAttribute('aria-label', example ? 'Mock example of weekly model counts' : 'Shared model counts over time');
}

export async function loadGlobalView(chart: HTMLElement, status: HTMLElement, table: HTMLElement | null, showExample = false): Promise<void> {
    try {
        const response = await fetch('/api/aggregate', { cache: 'no-store' });
        if (!response.ok) throw new Error('Shared timeline is unavailable.');
        const data: { weeks: AggregateRow[]; truncated: boolean } = await response.json();
        if (!Array.isArray(data.weeks)) throw new Error('Shared timeline is unavailable.');
        const rows = data.weeks.filter((row) => typeof row.week === 'string' && typeof row.model === 'string' &&
            Number.isSafeInteger(row.count) && row.count > 0 && Number.isSafeInteger(row.contributors) && row.contributors >= 5);
        if (rows.length === 0) {
            status.textContent = showExample
                ? 'Mock data · public counts appear after five contributors share a model and week.'
                : 'No weekly model has five contributors yet. Your local history still works without sharing.';
            if (showExample) renderRows(chart, exampleRows, true);
            else chart.replaceChildren();
            table?.replaceChildren();
            return;
        }
        renderRows(chart, rows, false);
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        const summary = `${total.toLocaleString('en-GB')} shared model uses · ${new Set(rows.map(({ week }) => week)).size} visible weeks`;
        status.textContent = showExample ? `${summary}${data.truncated ? ' · first 3,000 cells shown' : ''}` :
            `${summary}. ${data.truncated ? 'Only the first 3,000 eligible model-week cells are shown.' :
                'Long date ranges group weeks into months; faint ribbons link recurring model names, not people.'}`;
        if (table) {
            const tbody = document.createElement('tbody');
            for (const { week, model, count, contributors } of rows) {
                const tr = document.createElement('tr');
                for (const value of [week, model, count.toLocaleString('en-GB'), contributors.toLocaleString('en-GB')]) {
                    const cell = document.createElement('td');
                    cell.textContent = value;
                    tr.append(cell);
                }
                tbody.append(tr);
            }
            table.replaceChildren(tbody);
        }
    } catch {
        status.textContent = showExample ? 'Shared counts are unavailable. This chart uses mock data.'
            : 'The shared timeline is unavailable. Your local history still works.';
        if (showExample) renderRows(chart, exampleRows, true);
    }
}
