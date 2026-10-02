import type { UsageEvent } from './usage-data';

export const WEEKLY_FORMAT = 'model-tides-weekly';
export const WEEKLY_VERSION = 1;
export const MAX_WEEKS = 520;
export const MAX_CELLS = 2048;
export const MAX_MODEL_COUNT = 10_000;
export const MIN_WEEK_TIME = Date.UTC(1999, 11, 27);
export const FUTURE_MARGIN_MS = 7 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

export interface WeeklySnapshot {
    readonly format: typeof WEEKLY_FORMAT;
    readonly version: typeof WEEKLY_VERSION;
    readonly weeks: readonly { readonly week: string; readonly models: Readonly<Record<string, number>> }[];
}

export function validWeeklyModel(model: unknown): model is string {
    return typeof model === 'string' && model.length > 0 && model.length <= 320 &&
        model === model.trim() && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(model);
}

export function weekStart(time: number): string {
    if (!Number.isSafeInteger(time) || time < MIN_WEEK_TIME || time > Date.now() + FUTURE_MARGIN_MS) {
        throw new RangeError('The event date is outside the supported range.');
    }
    // Thursday 1970-01-01 is three days after Monday.
    return new Date(Math.floor((time + 3 * 86_400_000) / WEEK_MS) * WEEK_MS - 3 * 86_400_000)
        .toISOString().slice(0, 10);
}

export function buildWeeklySnapshot(events: Iterable<Pick<UsageEvent, 'time' | 'model'>>): WeeklySnapshot {
    const weeks = new Map<string, Map<string, number>>();
    for (const event of events) {
        if (!validWeeklyModel(event.model)) throw new TypeError('The model name cannot be shared.');
        const week = weekStart(event.time);
        const models = weeks.get(week) ?? new Map<string, number>();
        models.set(event.model, (models.get(event.model) ?? 0) + 1);
        weeks.set(week, models);
    }
    const result = [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, models]) => ({
        week,
        models: Object.fromEntries([...models].sort(([a], [b]) => a.localeCompare(b))),
    }));
    if (result.length > MAX_WEEKS || result.reduce((sum, item) => sum + Object.keys(item.models).length, 0) > MAX_CELLS ||
        result.some((item) => Object.values(item.models).some((count) => count > MAX_MODEL_COUNT))) {
        throw new RangeError('The weekly snapshot exceeds the upload limits.');
    }
    return { format: WEEKLY_FORMAT, version: WEEKLY_VERSION, weeks: result };
}
