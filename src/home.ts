import './model-usage.css';
import './flow-svg/flow-svg.css';
import { loadGlobalView } from './global-view';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The Model Tides home page needs a root element.');

const command = 'npx model-tides@latest upload';
root.innerHTML = `
    <main class="usage-app home-app">
        <header class="masthead">
            <a class="wordmark" href="/" aria-label="Model Tides home">
                <svg class="wordmark-mark" viewBox="0 0 32 24" fill="none" aria-hidden="true"><path d="M1 7c4-4 8-4 12 0s8 4 12 0 6-3 7-2M1 16c4-4 8-4 12 0s8 4 12 0 6-3 7-2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
                <span>MODEL TIDES<span class="wordmark-dot">.</span></span>
            </a>
            <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark theme">Dark theme</button>
        </header>

        <div class="home-intro"><h1>Your models, over time<span class="title-wave" aria-hidden="true"> ~</span></h1></div>

        <section class="home-cta" aria-labelledby="home-cta-heading">
            <h2 id="home-cta-heading">See (and optionally share) your own data</h2>
            <div class="command-strip" role="group" aria-label="Run Model Tides in your terminal">
                <span class="command-kind">npx</span>
                <code id="upload-command"><span class="command-prompt">npx</span> <span class="command-package">model-tides@latest</span> <span class="command-verb">upload</span></code>
                <button id="copy-command" class="copy-command" type="button" aria-label="Copy upload command" title="Copy command">
                    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
                </button>
            </div>
            <span id="copy-status" class="visually-hidden" role="status" aria-live="polite"></span>
        </section>

        <section class="global-card home-graph" aria-labelledby="global-heading">
            <h2 id="global-heading">Community model tides</h2>
            <p id="global-status" class="global-status" role="status" aria-live="polite">Loading shared model counts…</p>
            <div id="global-chart" class="global-chart" role="img" aria-label="Shared model counts over time"></div>
            <p class="global-note">Self-reported counts · each model and week needs five contributors to appear.</p>
        </section>

        <footer class="home-footer">Or <a href="https://github.com/BYK/model-tides" target="_blank" rel="noopener noreferrer">see the code ↗</a></footer>
    </main>
`;

const chart = root.querySelector<HTMLElement>('#global-chart')!;
const status = root.querySelector<HTMLElement>('#global-status')!;
void loadGlobalView(chart, status, null, true);

const copyStatus = root.querySelector<HTMLElement>('#copy-status')!;
const copyButton = root.querySelector<HTMLButtonElement>('#copy-command')!;
copyButton.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(command);
        copyStatus.textContent = 'Command copied.';
        copyButton.setAttribute('aria-label', 'Command copied');
        copyButton.title = 'Copied';
    } catch {
        copyStatus.textContent = 'Copy failed. Select the command to copy it.';
    }
});

const themeToggle = root.querySelector<HTMLButtonElement>('#theme-toggle')!;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
function updateTheme(): void {
    const dark = document.documentElement.dataset.theme === 'dark' ||
        (document.documentElement.dataset.theme !== 'light' && systemTheme.matches);
    themeToggle.textContent = dark ? 'Light theme' : 'Dark theme';
    themeToggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = dark ? '#102832' : '#eef6f5';
}
themeToggle.addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && systemTheme.matches) ? 'light' : 'dark';
    updateTheme();
});
systemTheme.addEventListener('change', updateTheme);
updateTheme();
