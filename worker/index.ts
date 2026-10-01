interface Env {
    ASSETS: { fetch(request: Request): Promise<Response> };
}

const reservedPaths = ['/api', '/u', '/og'];

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.hostname === 'www.modeltides.dev' || url.protocol !== 'https:') {
            url.hostname = 'modeltides.dev';
            url.protocol = 'https:';
            return Response.redirect(url, 308);
        }

        if (reservedPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
            return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
        }

        return env.ASSETS.fetch(request);
    },
};
