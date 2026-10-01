import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm?module';
import fontData from './og-font.ttf?inline';
import { imageSvg, type PublicReport } from './public-pages';

const initialized = initWasm(wasm);
const font = Uint8Array.from(atob(fontData.split(',')[1]), (character) => character.charCodeAt(0));

export async function renderImage(report: PublicReport): Promise<Response> {
    await initialized;
    const svg = new Resvg(imageSvg(report), { font: { fontBuffers: [font], defaultFontFamily: 'Noto Sans Mono' } });
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
