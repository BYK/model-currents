if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const localView = window.location.pathname === '/local' || window.location.pathname === '/local/';
const gistView = window.location.pathname === '/gist' || window.location.pathname === '/gist/';
const reportView = /^\/u\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(window.location.pathname);
void (localView ? import('./model-usage') : gistView ? import('./gist-page') : reportView ? import('./report-page') : import('./home')).catch(() => {
    const root = document.querySelector<HTMLElement>('#app');
    if (root) root.textContent = 'The page could not be loaded. Refresh to try again.';
});
