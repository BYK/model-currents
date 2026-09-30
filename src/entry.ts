if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {});
}

void import('./model-usage').catch(() => {
    const root = document.querySelector<HTMLElement>('#app');
    if (root) root.textContent = 'The page could not be loaded. Refresh to try again.';
});
