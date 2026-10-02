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
    const { results } = await db.prepare(`SELECT w.week, w.model, w.count FROM contributors c
        JOIN weekly_counts w ON w.contributor_id = c.id
        WHERE c.id = ? AND c.published = 1 ORDER BY w.week, w.model`)
        .bind(id).all<CountRow>();
    return results.length ? summarize(id, results) : null;
}

export function escapeHtml(text: string | number): string {
    return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function pageForReport(report: PublicReport, origin: string, shell: string): Response {
    const title = `${report.total.toLocaleString('en-GB')} model uses over ${report.weeks} ${report.weeks === 1 ? 'week' : 'weeks'} · Model Tides`;
    const description = 'A public, self-reported weekly model snapshot. Counts are observed session starts and model changes, not turns or tokens.';
    const url = `${origin}/u/${report.id}`;
    const image = `${origin}/og/${report.id}.png`;
    if (!shell.includes('</head>') || !shell.includes('id="app"')) throw new Error('Missing report app shell.');
    const meta = `<meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${image}"><meta name="twitter:card" content="summary_large_image">`;
    const html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
        .replace('</head>', `${meta}</head>`);
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
