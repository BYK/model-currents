import './model-usage.css';
import './flow-svg/flow-svg.css';
import { loadGlobalView } from './global-view';
import { setupTheme } from './theme';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The Model Tides home page needs a root element.');

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
            <h2 id="home-cta-heading">See and share your own model history</h2>
            <a class="command-strip" href="/local/">Explore and publish a personal chart in your browser →</a>
        </section>

        <section class="global-card home-graph" aria-labelledby="global-heading">
            <h2 id="global-heading">Community model tides</h2>
            <p id="global-status" class="global-status" role="status" aria-live="polite">Loading shared model counts…</p>
            <div id="global-chart" class="global-chart" role="img" aria-label="Shared model counts over time"></div>
            <p class="global-note">Self-reported counts · each model and week needs five contributors to appear.</p>
        </section>

        <footer class="home-footer"><a href="https://github.com/BYK/model-tides" target="_blank" rel="noopener noreferrer">see the code ↗</a></footer>
    </main>
`;

const chart = root.querySelector<HTMLElement>('#global-chart')!;
const status = root.querySelector<HTMLElement>('#global-status')!;
void loadGlobalView(chart, status, null, true);

setupTheme(root);
