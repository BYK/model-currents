export function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadShareImage(svg: SVGSVGElement, count: string, dateRange: string, source: string): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1050;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image export is unavailable in this browser.');

    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('width', '1480');
    copy.setAttribute('height', '680');
    copy.setAttribute('style', 'color:#eeeae2;font-family:Arial,sans-serif');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
        .chart-gridline { stroke: #393e47; stroke-width: 1; stroke-dasharray: 2 6; }
        .date-axis, .date-tick { stroke: #747b85; stroke-width: 1; }
        .date-label, .axis-caption { fill: #dddcd8; font-family: Arial, sans-serif; }
        .date-label { font-size: 11px; } .axis-caption { font-size: 8px; }
        .usage-node { stroke: #727782; stroke-width: .7; }
    `;
    copy.prepend(style);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();

        context.fillStyle = '#171a20';
        context.fillRect(0, 0, 1600, 1050);
        context.fillStyle = '#f17060';
        context.fillRect(60, 55, 7, 19);
        context.fillStyle = '#f0ede7';
        context.font = '23px Arial, sans-serif';
        context.fillText('MODEL CURRENTS', 82, 74);
        context.font = '58px Georgia, serif';
        context.fillText('The flow of attention', 60, 156);
        context.fillStyle = '#b0b5bb';
        context.font = '22px Arial, sans-serif';
        context.fillText(`${count} starts + switches   ·   ${dateRange}`, 60, 203);
        context.fillStyle = '#1e222a';
        context.fillRect(40, 220, 1520, 705);
        context.drawImage(image, 60, 230, 1480, 680);
        context.fillStyle = '#a5acb5';
        context.font = '19px Arial, sans-serif';
        context.fillText(source === 'example' ? 'INVENTED EXAMPLE · NO REAL USAGE DATA' : 'MODEL AND TIME METADATA ONLY', 60, 993);
        context.textAlign = 'right';
        const siteUrl = new URL('./', window.location.href);
        const site = window.location.protocol === 'https:'
            ? siteUrl.host + siteUrl.pathname
            : 'byk.github.io/model-currents/';
        context.fillText(site, 1540, 993);

        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
            (result) => result ? resolve(result) : reject(new Error('Image export failed.')), 'image/png',
        ));
        downloadBlob(blob, 'model-currents.png');
    } finally {
        URL.revokeObjectURL(url);
    }
}
