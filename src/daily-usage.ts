import { weekStart, validWeeklyModel } from './weekly-snapshot.ts';

export const DAILY_FORMAT = 'model-tides-daily';
export const DAILY_VERSION = 2;
export const MAX_DAILY_CELLS = 200_000;

export interface DailyUsageDocument {
    readonly format: typeof DAILY_FORMAT;
    readonly version: typeof DAILY_VERSION;
    readonly source: string;
    readonly days: readonly { readonly day: string; readonly models: Readonly<Record<string, number>> }[];
}

export function parseDailyDocument(input: unknown): DailyUsageDocument {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).sort().join() !== 'days,format,source,version') throw new TypeError('Invalid daily activity document.');
    const document = input as Record<string, unknown>;
    if (document.format !== DAILY_FORMAT || document.version !== DAILY_VERSION ||
        typeof document.source !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(document.source) ||
        !Array.isArray(document.days) || document.days.length < 1 || document.days.length > MAX_DAILY_CELLS) {
        throw new TypeError('Invalid daily activity document.');
    }
    const days: { day: string; models: Record<string, number> }[] = [];
    const previous = { day: '' };
    const cells = { count: 0 };
    for (const value of document.days) {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).sort().join() !== 'day,models' || typeof value.day !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || value.day <= previous.day ||
            !value.models || typeof value.models !== 'object' || Array.isArray(value.models)) {
            throw new TypeError('Invalid daily activity document.');
        }
        const time = Date.parse(`${value.day}T00:00:00Z`);
        if (!Number.isSafeInteger(time) || new Date(time).toISOString().slice(0, 10) !== value.day) {
            throw new TypeError('Invalid daily activity document.');
        }
        try { weekStart(time); } catch { throw new TypeError('Invalid daily activity document.'); }
        const entries = Object.entries(value.models);
        cells.count += entries.length;
        if (!entries.length || cells.count > MAX_DAILY_CELLS || entries.some(([model, count]) =>
            !validWeeklyModel(model) || !Number.isSafeInteger(count) || (count as number) < 1 ||
            (count as number) > 10_000)) throw new TypeError('Invalid daily activity document.');
        days.push({ day: value.day, models: Object.fromEntries(entries) as Record<string, number> });
        previous.day = value.day;
    }
    return { format: DAILY_FORMAT, version: DAILY_VERSION, source: document.source, days };
}
