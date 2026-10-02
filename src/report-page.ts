import './model-usage.css';
import './flow-svg/flow-svg.css';
import { renderWeeklyRows } from './global-view';
import { setupTheme } from './theme';
import { parsePublicReport } from './weekly-snapshot';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The shared report needs a root element.');
const id = window.location.pathname.slice('/u/'.length);
root.innerHTML = `
    <main class="usage-app home-app">
        <header class="masthead">
            <a class="wordmark" href="/" aria-label="Model Tides home">MODEL TIDES<span class="wordmark-dot">.</span></a>
            <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme">Dark theme</button>
        </header>
        <div class="home-intro"><h1>Model use over time</h1></div>
        <section class="global-card home-graph" aria-labelledby="report-heading">
            <h2 id="report-heading">Personal model timeline</h2>
            <p id="report-status" class="global-status" role="status" aria-live="polite">Loading shared weekly counts…</p>
            <div id="report-controls" hidden>
                <label>From week <input id="report-from" type="range"></label>
                <label>Through week <input id="report-to" type="range"></label>
                <button type="button" id="report-models">Show all models</button>
            </div>
            <div id="report-chart" class="global-chart" role="img" aria-label="Personal model counts over time"></div>
            <details id="report-details" class="global-details" hidden>
                <summary>View exact weekly counts</summary>
                <div class="global-table-scroll"><table><thead><tr><th>Week</th><th>Model</th><th>Count</th></tr></thead><tbody id="report-table"></tbody></table></div>
            </details>
            <p class="global-note">These are self-reported weekly model counts, not exact event times or individual sessions. Faint ribbons link recurring model names; they do not track sessions between weeks. Anyone with this link can view these counts.</p>
        </section>
        <footer class="home-footer"><a href="/local/">Explore your own history locally</a> · <a href="/">Model Tides home</a></footer>
    </main>`;
setupTheme(root);
const status = root.querySelector<HTMLElement>('#report-status')!;
const chart = root.querySelector<HTMLElement>('#report-chart')!;
const controls = root.querySelector<HTMLElement>('#report-controls')!;
const from = root.querySelector<HTMLInputElement>('#report-from')!;
const to = root.querySelector<HTMLInputElement>('#report-to')!;
const models = root.querySelector<HTMLButtonElement>('#report-models')!;
const details = root.querySelector<HTMLDetailsElement>('#report-details')!;
const table = root.querySelector<HTMLTableSectionElement>('#report-table')!;

void (async () => {
    const response = await fetch(`/api/contributions/${id}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Report unavailable.');
    const snapshot = parsePublicReport(await response.json(), id);
    const weeks = snapshot.weeks.map(({ week }) => week).sort();
    const allRows = snapshot.weeks.flatMap(({ week, models: counts }) =>
        Object.entries(counts).map(([model, count]) => ({ week, model, count })))
        .sort((a, b) => a.week.localeCompare(b.week) || a.model.localeCompare(b.model));
    from.min = to.min = '0';
    from.max = to.max = String(weeks.length - 1);
    from.value = '0';
    to.value = to.max;
    controls.hidden = false;
    details.hidden = false;
    const selection = { showAll: false };
    const render = (): void => {
        const start = Math.min(Number(from.value), Number(to.value));
        const end = Math.max(Number(from.value), Number(to.value));
        const rows = allRows.filter(({ week }) => week >= weeks[start] && week <= weeks[end]);
        renderWeeklyRows(chart, rows, 'shared', selection.showAll);
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        status.textContent = `${total.toLocaleString('en-GB')} model uses · ${weeks[start]} to ${weeks[end]} · ${new Set(rows.map(({ model }) => model)).size} models`;
        const body = document.createDocumentFragment();
        for (const { week, model, count } of rows) {
            const row = document.createElement('tr');
            for (const value of [week, model, count.toLocaleString('en-GB')]) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.append(cell);
            }
            body.append(row);
        }
        table.replaceChildren(body);
    };
    from.addEventListener('input', render);
    to.addEventListener('input', render);
    models.addEventListener('click', () => {
        selection.showAll = !selection.showAll;
        models.textContent = selection.showAll ? 'Group smaller models' : 'Show all models';
        render();
    });
    render();
})().catch(() => {
    controls.hidden = true;
    details.hidden = true;
    chart.replaceChildren();
    status.textContent = 'This report is hidden or unavailable.';
});
