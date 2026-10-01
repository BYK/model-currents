import type { Database } from './contributions';

export interface CountRow {
    readonly week: string;
    readonly model: string;
    readonly count: number;
}

export interface PublicReport {
    readonly id: string | null;
    readonly counts: readonly CountRow[];
    readonly total: number;
    readonly weeks: number;
    readonly models: readonly { model: string; count: number }[];
}

export function summarize(id: string | null, counts: readonly CountRow[]): PublicReport {
    const totals = new Map<string, number>();
    for (const { model, count } of counts) totals.set(model, (totals.get(model) ?? 0) + count);
    return {
        id,
        counts,
        total: counts.reduce((sum, row) => sum + row.count, 0),
        weeks: new Set(counts.map((row) => row.week)).size,
        models: [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([model, count]) => ({ model, count })),
    };
}

export async function getReport(db: Database, id: string): Promise<PublicReport | null> {
    const exists = await db.prepare('SELECT id FROM contributors WHERE id = ?').bind(id).first<{ id: string }>();
    if (!exists) return null;
    const { results } = await db.prepare('SELECT week, model, count FROM weekly_counts WHERE contributor_id = ? ORDER BY week, model')
        .bind(id).all<CountRow>();
    return summarize(id, results);
}

export function escapeHtml(text: string | number): string {
    return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function pageForReport(report: PublicReport, origin: string): Response {
    const title = `${report.total.toLocaleString('en-GB')} model uses over ${report.weeks} ${report.weeks === 1 ? 'week' : 'weeks'} · Model Tides`;
    const description = 'A public, self-reported weekly model snapshot. Counts are observed session starts and model changes, not turns or tokens.';
    const url = `${origin}/u/${report.id}`;
    const image = `${origin}/og/${report.id}.png`;
    const rows = report.counts.map(({ week, model, count }) =>
        `<tr><th scope="row">${escapeHtml(week)}</th><td>${escapeHtml(model)}</td><td>${escapeHtml(count)}</td></tr>`).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${image}"><meta name="twitter:card" content="summary_large_image">
<style>body{margin:0;background:#eef6f5;color:#17343e;font:16px system-ui,sans-serif}main{max-width:960px;margin:auto;padding:36px 24px}a{color:#0d7077}h1{font:normal clamp(34px,6vw,64px) Georgia,serif}p{line-height:1.6}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #ccdddf}td:last-child{text-align:right;font-variant-numeric:tabular-nums}@media(prefers-color-scheme:dark){body{background:#102832;color:#eef6f5}table{background:#18323c}th,td{border-color:#38545d}a{color:#82d6ca}}</style>
</head><body><main><a href="/">← Model Tides</a><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)} This link shows only weekly model names and counts; it does not contain prompts, responses, exact event times, or session IDs.</p>
<table><thead><tr><th scope="col">Week of</th><th scope="col">Model</th><th scope="col">Uses</th></tr></thead><tbody>${rows}</tbody></table>
<p><a href="/">Explore your own history locally</a></p></main></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function imageSvg(report: PublicReport): string {
    const bars = report.models.slice(0, 5).map(({ model, count }, index) => {
        const y = 322 + index * 60;
        const width = Math.max(6, Math.round(580 * count / Math.max(1, report.models[0].count)));
        const label = [...model].slice(0, 39).join('');
        return `<text x="80" y="${y}" fill="#eaf7f6" font-size="28">${escapeHtml(label)}</text>
<rect x="80" y="${y + 16}" width="${width}" height="17" rx="8" fill="#82d6ca"/>
<text x="1110" y="${y + 1}" fill="#eaf7f6" font-size="28" text-anchor="end">${escapeHtml(count.toLocaleString('en-GB'))}</text>`;
    }).join('');
    const label = report.id === null ? 'COMMUNITY SNAPSHOT' : 'SHARED MODEL HISTORY';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#102832"/><path d="M0 135Q300 65 600 135T1200 135" fill="none" stroke="#2b6e76" stroke-width="4"/>
<text x="80" y="92" fill="#82d6ca" font-size="28" letter-spacing="4">MODEL TIDES  ·  ${label}</text>
<text x="80" y="207" fill="#eaf7f6" font-size="72">${escapeHtml(report.total.toLocaleString('en-GB'))} model uses</text>
<text x="80" y="265" fill="#adc6c9" font-size="30">${report.weeks} ${report.weeks === 1 ? 'week' : 'weeks'} · self-reported weekly counts</text>
${bars}<text x="80" y="600" fill="#adc6c9" font-size="22">modeltides.dev · models and weekly counts only</text></svg>`;
}
