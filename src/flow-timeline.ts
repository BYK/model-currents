import { clampEndDay, clampStartDay, panDateRange, zoomDateRange, type DayRange } from './timeline-zoom';

const DAY = 86_400_000;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const formatDate = (day: number, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(day * DAY));

interface FlowTimelineElements {
    readonly canvas: HTMLElement;
    readonly scroll: HTMLElement;
    readonly start: HTMLInputElement;
    readonly end: HTMLInputElement;
    readonly selection: HTMLElement;
    readonly fromDate: HTMLElement;
    readonly toDate: HTMLElement;
    readonly minLabel: HTMLElement;
    readonly maxLabel: HTMLElement;
    readonly zoomIn: HTMLButtonElement;
    readonly zoomOut: HTMLButtonElement;
    readonly zoomReset: HTMLButtonElement;
}

interface Pan {
    pointerId: number;
    startX: number;
    startY: number;
    startDay: number;
    endDay: number;
    plotWidth: number;
    viewBoxWidth: number;
    clientWidth: number;
    moved: boolean;
}

export function setupFlowTimeline(
    elements: FlowTimelineElements,
    range: () => DayRange,
    onChange: (startDay: number, endDay: number) => void,
): { update: () => void } {
    const { canvas, scroll, start, end, selection, fromDate, toDate, minLabel, maxLabel, zoomIn, zoomOut, zoomReset } = elements;
    const pan: { current: Pan | null } = { current: null };
    const update = (): void => {
        const { minDay, maxDay, startDay, endDay } = range();
        start.min = end.min = String(minDay);
        start.max = end.max = String(maxDay);
        start.value = String(startDay);
        end.value = String(endDay);
        const span = Math.max(1, maxDay - minDay);
        const left = (startDay - minDay) / span * 100;
        const right = (endDay - minDay) / span * 100;
        selection.style.left = `${left}%`;
        selection.style.width = `${right - left}%`;
        fromDate.textContent = formatDate(startDay);
        toDate.textContent = formatDate(endDay);
        minLabel.textContent = formatDate(minDay, { month: 'short', year: 'numeric' });
        maxLabel.textContent = formatDate(maxDay, { month: 'short', year: 'numeric' });
        const selectedDays = endDay - startDay + 1;
        const availableDays = maxDay - minDay + 1;
        scroll.classList.toggle('is-pannable', selectedDays < availableDays);
        zoomIn.disabled = selectedDays <= 2;
        zoomOut.disabled = selectedDays >= availableDays;
        zoomReset.hidden = selectedDays >= availableDays;
    };
    const setRange = (startDay: number, endDay: number): void => {
        onChange(startDay, endDay);
        update();
    };
    const zoom = (factor: number, anchorDay?: number, anchorPosition?: number): boolean => {
        const current = range();
        const next = zoomDateRange(current, factor, anchorDay === undefined && anchorPosition === undefined
            ? undefined
            : { day: anchorDay ?? (current.startDay + current.endDay) / 2, position: anchorPosition ?? 0.5 });
        if (!next) return false;
        setRange(next.startDay, next.endDay);
        return true;
    };
    const geometry = () => {
        const svg = canvas.querySelector<SVGSVGElement>('svg.flow-svg');
        const bounds = svg?.getBoundingClientRect();
        if (!svg || !bounds || bounds.width <= 0) return null;
        const width = svg.viewBox.baseVal.width || scroll.clientWidth;
        const firstX = Number(svg.dataset.flowPlotStartX);
        const lastX = Number(svg.dataset.flowPlotEndX);
        const firstPeriod = Number(svg.dataset.flowPlotStartTime);
        const lastPeriod = Number(svg.dataset.flowPlotEndTime);
        return [width, firstX, lastX, firstPeriod, lastPeriod].every(Number.isFinite)
            ? { bounds, width, firstX, lastX, firstPeriod, lastPeriod } : null;
    };
    scroll.addEventListener('wheel', (event: WheelEvent) => {
        if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
        const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * scroll.clientHeight : event.deltaY;
        const plot = geometry();
        const current = range();
        const anchor = plot && plot.firstPeriod !== plot.lastPeriod ? (() => {
            const x = (event.clientX - plot.bounds.left) / plot.bounds.width * plot.width;
            const position = clamp((x - plot.firstX) / Math.max(1, plot.lastX - plot.firstX), 0, 1);
            return { day: clamp((plot.firstPeriod + position * (plot.lastPeriod - plot.firstPeriod)) / DAY,
                current.startDay, current.endDay), position };
        })() : { day: (current.startDay + current.endDay) / 2, position: 0.5 };
        if (zoom(Math.pow(1.2, clamp(delta / 100, -4, 4)), anchor.day, anchor.position)) event.preventDefault();
    }, { passive: false });
    scroll.addEventListener('pointerdown', (event: PointerEvent) => {
        const plot = geometry();
        const current = range();
        if (event.button !== 0 || !plot || plot.lastX <= plot.firstX ||
            current.endDay - current.startDay >= current.maxDay - current.minDay) return;
        pan.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            startDay: current.startDay, endDay: current.endDay, plotWidth: plot.lastX - plot.firstX,
            viewBoxWidth: plot.width, clientWidth: plot.bounds.width, moved: false };
        scroll.setPointerCapture(event.pointerId);
    });
    scroll.addEventListener('pointermove', (event: PointerEvent) => {
        const active = pan.current;
        if (!active || event.pointerId !== active.pointerId) return;
        const deltaX = event.clientX - active.startX;
        const deltaY = event.clientY - active.startY;
        if (!active.moved && Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) return;
        if (!active.moved && Math.abs(deltaY) > Math.abs(deltaX)) {
            pan.current = null;
            if (scroll.hasPointerCapture(event.pointerId)) scroll.releasePointerCapture(event.pointerId);
            return;
        }
        active.moved = true;
        scroll.classList.add('is-panning');
        event.preventDefault();
        const offset = -(deltaX * active.viewBoxWidth / active.clientWidth) / active.plotWidth *
            (active.endDay - active.startDay);
        const next = panDateRange({ ...range(), startDay: active.startDay, endDay: active.endDay }, offset);
        if (next) setRange(next.startDay, next.endDay);
    });
    const endPan = (event: PointerEvent): void => {
        if (!pan.current || event.pointerId !== pan.current.pointerId) return;
        pan.current = null;
        scroll.classList.remove('is-panning');
        if (scroll.hasPointerCapture(event.pointerId)) scroll.releasePointerCapture(event.pointerId);
    };
    scroll.addEventListener('pointerup', endPan);
    scroll.addEventListener('pointercancel', endPan);
    scroll.addEventListener('lostpointercapture', endPan);
    start.addEventListener('input', () => {
        const current = range();
        setRange(clampStartDay(Number(start.value), current.minDay, current.endDay), current.endDay);
    });
    end.addEventListener('input', () => {
        const current = range();
        setRange(current.startDay, clampEndDay(Number(end.value), current.startDay, current.maxDay));
    });
    zoomIn.addEventListener('click', () => { zoom(1 / 1.2); });
    zoomOut.addEventListener('click', () => { zoom(1.2); });
    zoomReset.addEventListener('click', () => {
        const current = range();
        setRange(current.minDay, current.maxDay);
    });
    return { update };
}
