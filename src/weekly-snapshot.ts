import type { UsageEvent } from './usage-data';

export const WEEKLY_FORMAT = 'model-tides-weekly';
export const WEEKLY_VERSION = 1;
export const MAX_WEEKS = 520;
export const MAX_CELLS = 2048;
export const MAX_MODEL_COUNT = 10_000;
export const MIN_WEEK_TIME = Date.UTC(1999, 11, 27);
export const FUTURE_MARGIN_MS = 7 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;
const weekPattern = /^\d{4}-\d{2}-\d{2}$/;

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

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

export function parseSnapshot(input: unknown): WeeklySnapshot {
    if (!exactKeys(input, ['format', 'version', 'weeks']) || input.format !== WEEKLY_FORMAT ||
        input.version !== WEEKLY_VERSION || !Array.isArray(input.weeks) ||
        input.weeks.length < 1 || input.weeks.length > MAX_WEEKS) {
        throw new TypeError('Invalid weekly snapshot.');
    }
    const seen = new Set<string>();
    const weeks: { week: string; models: Record<string, number> }[] = [];
    const latest = Date.now() + FUTURE_MARGIN_MS;
    const cells = input.weeks.reduce<number>((total, item: unknown) => {
        if (!exactKeys(item, ['week', 'models']) || typeof item.week !== 'string' ||
            !weekPattern.test(item.week) || seen.has(item.week) || !item.models ||
            typeof item.models !== 'object' || Array.isArray(item.models)) {
            throw new TypeError('Invalid weekly snapshot.');
        }
        const date = Date.parse(`${item.week}T00:00:00Z`);
        if (!Number.isFinite(date) || date < MIN_WEEK_TIME || date > latest ||
            weekStart(date) !== item.week) {
            throw new TypeError('Invalid weekly snapshot.');
        }
        const entries = Object.entries(item.models);
        if (entries.length > MAX_CELLS || entries.some(([model, count]) =>
            !validWeeklyModel(model) || !Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > MAX_MODEL_COUNT)) {
            throw new TypeError('Invalid weekly snapshot.');
        }
        seen.add(item.week);
        weeks.push({ week: item.week, models: Object.fromEntries(entries) });
        return total + entries.length;
    }, 0);
    if (cells < 1 || cells > MAX_CELLS) throw new TypeError('Invalid weekly snapshot.');
    return { format: WEEKLY_FORMAT, version: WEEKLY_VERSION, weeks };
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
