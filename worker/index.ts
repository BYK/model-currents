import { getAggregate, handleContributions, type Database, type UploadLimit } from './contributions.ts';
import { escapeHtml, getReport, pageForReport, summarize } from './public-pages.ts';

interface Env {
    ASSETS: { fetch(request: Request): Promise<Response> };
    DB: Database;
    UPLOAD_LIMIT: UploadLimit;
}

const reservedPaths = ['/api', '/u', '/og'];
const idPattern = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const publicPath = new RegExp(`^/u/(${idPattern})$`);
const imagePath = new RegExp(`^/og/(${idPattern})\\.png$`);
const gistPath = /^\/gist\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[0-9a-f]{32}\/?$/;

async function home(request: Request, env: Env): Promise<Response> {
    const asset = await env.ASSETS.fetch(request);
    if (!asset.ok || !env.DB) return asset;
    try {
        const aggregate = await getAggregate(env.DB);
        const total = aggregate.weeks.reduce((sum, row) => sum + row.count, 0);
        const title = total ? `${total.toLocaleString('en-GB')} shared model uses · Model Tides` : 'Model Tides — Your models, over time.';
        const description = 'See model use over time. Explore shared weekly counts, or review your own history and choose whether to share.';
        const origin = new URL(request.url).origin;
        const meta = `<meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${origin}/">
<meta property="og:image" content="${origin}/og/global.png"><meta name="twitter:card" content="summary_large_image">`;
        return new Response((await asset.clone().text()).replace('</head>', `${meta}</head>`), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        });
    } catch {
        return asset;
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.hostname === 'www.modeltides.dev' || url.protocol !== 'https:') {
            url.hostname = 'modeltides.dev';
            url.protocol = 'https:';
            return Response.redirect(url, 308);
        }

        if (reservedPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
            if (url.pathname.startsWith('/api/') &&
                (url.pathname === '/api/aggregate' || url.pathname === '/api/contributions' ||
                    url.pathname.startsWith('/api/contributions/'))) {
                if (!env.DB || !env.UPLOAD_LIMIT) {
                    return new Response('Service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
                }
                try {
                    return await handleContributions(request, env.DB, env.UPLOAD_LIMIT, url.pathname);
                } catch {
                    return new Response('Service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
                }
            }
            const id = publicPath.exec(url.pathname)?.[1] ?? imagePath.exec(url.pathname)?.[1];
            const globalImage = url.pathname === '/og/global.png';
            if ((id || globalImage) && (request.method === 'GET' || request.method === 'HEAD')) {
                if (!env.DB) return new Response('Service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
                try {
                    const report = globalImage
                        ? summarize(null, (await getAggregate(env.DB)).weeks)
                        : await getReport(env.DB, id!);
                    if (!report) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
                    if (publicPath.test(url.pathname)) return pageForReport(report, url.origin);
                    if (request.method === 'HEAD') return new Response(null, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
                    const { renderImage } = await import('./og.ts');
                    return await renderImage(report);
                } catch {
                    return new Response('Service unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
                }
            }
            return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
        }

        if (url.pathname === '/local' || url.pathname === '/local/' || gistPath.test(url.pathname)) {
            return env.ASSETS.fetch(new Request(new URL('/', url), request));
        }
        return url.pathname === '/' && request.method === 'GET' ? home(request, env) : env.ASSETS.fetch(request);
    },
};
