if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

void import('./model-usage').catch(() => {
    const root = document.querySelector<HTMLElement>('#app');
    if (root) root.textContent = 'The page could not be loaded. Refresh to try again.';
});
