import { renderFlowSvg } from './flow-svg/renderer';
import { getModelColor } from './model-colors';

interface AggregateRow {
    readonly week: string;
    readonly model: string;
    readonly count: number;
    readonly contributors: number;
}

export async function loadGlobalView(chart: HTMLElement, status: HTMLElement, table: HTMLElement): Promise<void> {
    try {
        const response = await fetch('/api/aggregate', { cache: 'no-store' });
        if (!response.ok) throw new Error('Shared timeline is unavailable.');
        const data: { weeks: AggregateRow[]; truncated: boolean } = await response.json();
        if (!Array.isArray(data.weeks)) throw new Error('Shared timeline is unavailable.');
        const rows = data.weeks.filter((row) => typeof row.week === 'string' && typeof row.model === 'string' &&
            Number.isSafeInteger(row.count) && row.count > 0 && Number.isSafeInteger(row.contributors) && row.contributors >= 5);
        if (rows.length === 0) {
            status.textContent = 'No weekly model has five contributors yet. Your local history still works without sharing.';
            chart.replaceChildren();
            table.replaceChildren();
            return;
        }
        const totals = new Map<string, number>();
        for (const { model, count } of rows) totals.set(model, (totals.get(model) ?? 0) + count);
        const ordered = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const visible = new Set(ordered.slice(0, 6).map(([model]) => model));
        const times = rows.map(({ week }) => Date.parse(`${week}T00:00:00Z`));
        const first = Math.min(...times);
        const last = Math.max(...times) + 6 * 86_400_000;
        const svg = renderFlowSvg(rows.map(({ week, model, count }) => ({
            time: Date.parse(`${week}T00:00:00Z`), to: model, weight: count,
        })), {
            start: first, end: last, width: 1100, height: 400,
            order: [...visible, 'Other models'],
            displayKey: (model) => visible.has(model) ? model : 'Other models',
            colorFor: getModelColor,
            streamColorFor: (model) => getModelColor(model),
            formatValue: (value) => `${value.toLocaleString('en-GB')} shared uses`,
            formatNodeTitle: ({ label, period, value }) => `${label} · ${period}\n${value.toLocaleString('en-GB')} self-reported uses`,
            formatLinkTitle: ({ toLabel, toPeriod, value }) => `${toLabel} · ${toPeriod}\n${value.toLocaleString('en-GB')} self-reported uses`,
            formatContinuityTitle: ({ label, fromPeriod, toPeriod }) => `${label}: appears in ${fromPeriod} and ${toPeriod}. This does not track people between periods.`,
            axisCaption: 'EARLIER ← REPORTED MODEL COUNTS → LATER',
            ariaLabel: 'Self-reported model counts by week, grouped into wider periods over longer histories',
        });
        chart.innerHTML = svg;
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        status.textContent = `${total.toLocaleString('en-GB')} shared model uses across ${new Set(rows.map(({ week }) => week)).size} visible weeks. ` +
            (data.truncated ? 'Only the first 3,000 eligible model-week cells are shown.' :
                'Long date ranges group weeks into months; faint ribbons link recurring model names, not people.');
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
    } catch {
        status.textContent = 'The shared timeline is unavailable. Your local history still works.';
    }
}
