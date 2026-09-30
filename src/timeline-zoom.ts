export interface DayRange {
    readonly minDay: number;
    readonly maxDay: number;
    readonly startDay: number;
    readonly endDay: number;
}

export interface ZoomAnchor {
    readonly day: number;
    readonly position: number;
}

function validateRange(range: DayRange): void {
    const { minDay, maxDay, startDay, endDay } = range;
    if (![minDay, maxDay, startDay, endDay].every(Number.isSafeInteger) ||
        maxDay < minDay || startDay < minDay || endDay > maxDay || endDay < startDay) {
        throw new RangeError('Date range must contain ordered integer days within its bounds.');
    }
}

export function zoomDateRange(
    range: DayRange,
    factor: number,
    anchor?: ZoomAnchor,
): { startDay: number; endDay: number } | null {
    const { minDay, maxDay, startDay, endDay } = range;
    validateRange(range);
    if (!Number.isFinite(factor) || factor <= 0) return null;

    const availableDays = maxDay - minDay + 1;
    const selectedDays = endDay - startDay + 1;
    if (availableDays < 2 || selectedDays < 2) return null;
    const nextDays = Math.min(availableDays, Math.max(2, Math.round(selectedDays * factor)));
    if (nextDays === selectedDays) return null;

    const defaultDay = (startDay + endDay) / 2;
    const requestedDay = anchor && Number.isFinite(anchor.day) ? anchor.day : defaultDay;
    const anchorDay = Math.min(endDay, Math.max(startDay, requestedDay));
    const defaultPosition = (anchorDay - startDay) / Math.max(1, endDay - startDay);
    const requestedPosition = anchor && Number.isFinite(anchor.position) ? anchor.position : defaultPosition;
    const position = Math.min(1, Math.max(0, requestedPosition));
    const maxStartDay = maxDay - nextDays + 1;
    const nextStartDay = Math.min(maxStartDay, Math.max(minDay, Math.round(anchorDay - position * (nextDays - 1))));
    return { startDay: nextStartDay, endDay: nextStartDay + nextDays - 1 };
}

export function panDateRange(range: DayRange, dayOffset: number): { startDay: number; endDay: number } | null {
    validateRange(range);
    if (!Number.isFinite(dayOffset)) return null;

    const { minDay, maxDay, startDay, endDay } = range;
    const span = endDay - startDay;
    const nextStartDay = Math.min(maxDay - span, Math.max(minDay, Math.round(startDay + dayOffset)));
    if (nextStartDay === startDay) return null;
    return { startDay: nextStartDay, endDay: nextStartDay + span };
}

export function clampStartDay(requested: number, minDay: number, endDay: number): number {
    if (!Number.isFinite(requested) || !Number.isSafeInteger(minDay) || !Number.isSafeInteger(endDay) || endDay <= minDay) {
        throw new RangeError('Start date must be finite and the end date must leave at least one later day.');
    }
    return Math.min(endDay - 1, Math.max(minDay, Math.round(requested)));
}

export function clampEndDay(requested: number, startDay: number, maxDay: number): number {
    if (!Number.isFinite(requested) || !Number.isSafeInteger(startDay) || !Number.isSafeInteger(maxDay) || maxDay <= startDay) {
        throw new RangeError('End date must be finite and the start date must leave at least one earlier day.');
    }
    return Math.min(maxDay, Math.max(startDay + 1, Math.round(requested)));
}
