export function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadShareImage(svg: SVGSVGElement, count: string, dateRange: string, source: string): Promise<void> {
    const isDark = document.documentElement.dataset.theme === 'dark' ||
        (document.documentElement.dataset.theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const theme = isDark
        ? { background: '#102832', panel: '#18323c', text: '#eef6f5', muted: '#adc6c9', accent: '#82d6ca', grid: '#294751', axis: '#64828a', outline: '#d4e6e5' }
        : { background: '#eef6f5', panel: '#ffffff', text: '#17343e', muted: '#496b73', accent: '#0d7077', grid: '#dceae9', axis: '#a2b9bc', outline: '#ffffff' };
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1050;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');

    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('width', '1480');
    copy.setAttribute('height', '680');
    copy.setAttribute('style', `color:${theme.muted};font-family:Arial,sans-serif`);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
        .chart-gridline { stroke: ${theme.grid}; stroke-width: 1; stroke-dasharray: 2 6; }
        .date-axis, .date-tick { stroke: ${theme.axis}; stroke-width: 1; }
        .date-label, .axis-caption { fill: ${theme.muted}; font-family: Arial, sans-serif; }
        .date-label { font-size: 11px; } .axis-caption { font-size: 8px; }
        .usage-node { stroke: ${theme.outline}; stroke-width: .7; }
        .flow-entry { opacity: .34; } .flow-transition { opacity: .3; }
        .flow-intra { opacity: .58; } .continuity-ribbon { opacity: .24; }
    `;
    copy.prepend(style);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();

        context.fillStyle = theme.background;
        context.fillRect(0, 0, 1600, 1050);
        context.strokeStyle = theme.accent;
        context.lineWidth = 4;
        for (const y of [58, 72]) {
            context.beginPath();
            context.moveTo(60, y);
            context.bezierCurveTo(68, y - 8, 76, y + 8, 84, y);
            context.bezierCurveTo(92, y - 8, 100, y + 8, 108, y);
            context.stroke();
        }
        context.fillStyle = theme.text;
        context.font = '23px Arial, sans-serif';
        context.fillText('MODEL TIDES', 124, 74);
        context.font = '58px Georgia, serif';
        context.fillText('Your models, over time.', 60, 156);
        context.fillStyle = theme.muted;
        context.font = '22px Arial, sans-serif';
        context.fillText(`${count} starts + switches   ·   ${dateRange}`, 60, 203);
        context.fillStyle = theme.panel;
        context.fillRect(40, 220, 1520, 705);
        context.drawImage(image, 60, 230, 1480, 680);
        context.fillStyle = theme.muted;
        context.font = '19px Arial, sans-serif';
        context.fillText(source === 'example' ? 'INVENTED EXAMPLE · NO REAL USAGE DATA' : 'MODEL AND TIME METADATA ONLY', 60, 993);
        context.textAlign = 'right';
        const siteUrl = new URL('./', window.location.href);
        const site = window.location.protocol === 'https:'
            ? siteUrl.host + siteUrl.pathname
            : 'byk.im/model-tides/';
        context.fillText(site, 1540, 993);

        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            (result) => result ? resolve(result) : reject(new Error('Image export failed.')), 'image/png',
        ));
        downloadBlob(blob, 'model-tides.png');
    } finally {
        URL.revokeObjectURL(url);
    }
}
