import './model-usage.css';
import './flow-svg/flow-svg.css';
import { loadGistSnapshot } from './gist-view';
import { renderWeeklyRows } from './global-view';
import { setupTheme } from './theme';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The Model Tides gist page needs a root element.');

root.innerHTML = `
    <main class="usage-app home-app">
        <header class="masthead">
            <a class="wordmark" href="/" aria-label="Model Tides home">
                <svg class="wordmark-mark" viewBox="0 0 32 24" fill="none" aria-hidden="true"><path d="M1 7c4-4 8-4 12 0s8 4 12 0 6-3 7-2M1 16c4-4 8-4 12 0s8 4 12 0 6-3 7-2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
                <span>MODEL TIDES<span class="wordmark-dot">.</span></span>
            </a>
            <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme">Dark theme</button>
        </header>

        <div class="home-intro"><h1>Unlisted weekly counts</h1></div>
        <section class="global-card home-graph" aria-labelledby="gist-heading">
            <h2 id="gist-heading">Model use over time</h2>
            <p id="gist-status" class="global-status" role="status" aria-live="polite">Loading weekly counts from GitHub…</p>
            <div id="gist-chart" class="global-chart" role="img" aria-label="Unlisted gist model counts over time"></div>
            <details id="gist-details" class="global-details" hidden>
                <summary>View exact weekly counts</summary>
                <div class="global-table-scroll"><table><thead><tr><th>Week</th><th>Model</th><th>Count</th></tr></thead><tbody id="gist-table"></tbody></table></div>
            </details>
            <p class="global-note">Your browser reads this unlisted gist directly from GitHub. Model Tides never receives its file contents. Anyone with the link can read the counts, and GitHub retains revisions.</p>
        </section>
        <footer class="home-footer"><a id="gist-source" href="https://gist.github.com/" target="_blank" rel="noopener noreferrer">View gist on GitHub ↗</a> · <a href="/local/">Open your private timeline</a></footer>
    </main>
`;

setupTheme(root);
const status = root.querySelector<HTMLElement>('#gist-status')!;
const chart = root.querySelector<HTMLElement>('#gist-chart')!;
const details = root.querySelector<HTMLDetailsElement>('#gist-details')!;
const table = root.querySelector<HTMLTableSectionElement>('#gist-table')!;
const source = root.querySelector<HTMLAnchorElement>('#gist-source')!;
const match = /^\/gist\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([0-9a-f]{32})\/?$/.exec(window.location.pathname);

if (!match) {
    status.textContent = 'Invalid gist address.';
    source.hidden = true;
} else {
    const [, owner, id] = match;
    source.href = `https://gist.github.com/${owner}/${id}`;
    void loadGistSnapshot(owner, id).then((snapshot) => {
        const rows = snapshot.weeks.flatMap(({ week, models }) =>
            Object.entries(models).map(([model, count]) => ({ week, model, count })))
            .sort((a, b) => a.week.localeCompare(b.week) || a.model.localeCompare(b.model));
        renderWeeklyRows(chart, rows, 'gist');
        const total = rows.reduce((sum, row) => sum + row.count, 0);
        status.textContent = `${total.toLocaleString('en-GB')} self-reported model uses across ${snapshot.weeks.length} weeks · unlisted gist by ${owner}`;
        const body = document.createDocumentFragment();
        for (const { week, model, count } of rows) {
            const tr = document.createElement('tr');
            for (const value of [week, model, count.toLocaleString('en-GB')]) {
                const cell = document.createElement('td');
                cell.textContent = value;
                tr.append(cell);
            }
            body.append(tr);
        }
        table.replaceChildren(body);
        details.hidden = false;
    }).catch(() => {
        status.textContent = 'Could not load this weekly-count gist from GitHub. Check the link and connection.';
    });
}
