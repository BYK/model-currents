import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSvg, pageForReport, summarize } from '../worker/public-pages.ts';

const shell = '<!doctype html><html><head><title>Model Tides</title></head><body><div id="app"></div><script type="module" src="/assets/index-hashed.js"></script></body></html>';

test('shared HTML and SVG have matching counts, exact OG links, and escaped model labels', async () => {
    const id = '019ff796-7912-7786-a7bf-a964d071294a';
    const report = summarize(id, [
        { week: '2026-09-28', model: '<script>alert(1)</script>', count: 2 },
        { week: '2026-10-05', model: '<script>alert(1)</script>', count: 3 },
        { week: '2026-10-05', model: 'openai/gpt-5', count: 1 },
    ]);
    assert.equal(report.total, 6);
    assert.equal(report.weeks, 2);
    assert.deepEqual(report.models[0], { model: '<script>alert(1)</script>', count: 5 });
    const page = await pageForReport(report, 'https://example.test', shell).text();
    assert.match(page, /https:\/\/example\.test\/og\/019ff796-7912-7786-a7bf-a964d071294a\.png/);
    assert.match(page, /6 model uses over 2 weeks/);
    assert.equal(page.includes('<script>alert(1)</script>'), false);
    assert.doesNotMatch(page, /alert\(1\)/, 'the HTML shell never embeds untrusted model names');
    const image = imageSvg(report);
    assert.match(image, /6 model uses/);
    assert.match(image, /5<\/text>/);
    assert.equal(image.includes('<script>'), false);
    const oneWeek = summarize(id, [{ week: '2026-09-28', model: 'openai/gpt-5', count: 2 }]);
    assert.match(await pageForReport(oneWeek, 'https://example.test', shell).text(), /2 model uses over 1 week · Model Tides/);
});

test('public report serves the interactive app shell with accurate per-link metadata', async () => {
    const id = '019ff796-7912-7786-a7bf-a964d071294a';
    const report = summarize(id, [{ week: '2026-09-28', model: 'openai/gpt-5', count: 2 }]);
    const page = await pageForReport(report, 'https://example.test', shell).text();
    assert.match(page, /<div id="app"><\/div><script type="module" src="\/assets\/index-hashed\.js"><\/script>/);
    assert.match(page, /<meta property="og:url" content="https:\/\/example\.test\/u\/019ff796-7912-7786-a7bf-a964d071294a">/);
    assert.match(page, /2 model uses over 1 week/);
    assert.doesNotMatch(page, /<table>/);
});
