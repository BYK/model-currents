if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

const localView = window.location.pathname === '/local' || window.location.pathname === '/local/';
void (localView ? import('./model-usage') : import('./home')).catch(() => {
    const root = document.querySelector<HTMLElement>('#app');
    if (root) root.textContent = 'The page could not be loaded. Refresh to try again.';
});
