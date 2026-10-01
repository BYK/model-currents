import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSvg, pageForReport, summarize } from '../worker/public-pages.ts';

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
    const page = await pageForReport(report, 'https://example.test').text();
    assert.match(page, /https:\/\/example\.test\/og\/019ff796-7912-7786-a7bf-a964d071294a\.png/);
    assert.match(page, /6 model uses over 2 weeks/);
    assert.equal(page.includes('<script>alert(1)</script>'), false);
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const image = imageSvg(report);
    assert.match(image, /6 model uses/);
    assert.match(image, /5<\/text>/);
    assert.equal(image.includes('<script>'), false);
    const oneWeek = summarize(id, [{ week: '2026-09-28', model: 'openai/gpt-5', count: 2 }]);
    assert.match(await pageForReport(oneWeek, 'https://example.test').text(), /2 model uses over 1 week · Model Tides/);
});
