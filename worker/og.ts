import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm?module';
import aileFont from '../src/fonts/iosevka-aile-site-400.woff2?inline';
import etoileFont from '../src/fonts/iosevka-etoile-site-400.woff2?inline';
import monoFont from '../src/fonts/iosevka-site-400.woff2?inline';
import { imageSvg, type PublicReport } from './public-pages';

const initialized = initWasm(wasm);
const fonts = [aileFont, etoileFont, monoFont].map((data) =>
    Uint8Array.from(atob(data.split(',')[1]), (character) => character.charCodeAt(0)));

export async function renderImage(report: PublicReport): Promise<Response> {
    await initialized;
    const svg = new Resvg(imageSvg(report), { font: { fontBuffers: fonts, defaultFontFamily: 'Iosevka Aile' } });
    try {
        const image = svg.render();
        try {
            const png = image.asPng();
            return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        } finally {
            image.free();
        }
    } finally {
        svg.free();
    }
}
