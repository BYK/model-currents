export interface UsageEvent {
    readonly time: number;
    readonly model: string;
    readonly kind: 'session' | 'switch';
    readonly fromModel?: string;
    readonly fromTime?: number;
}

export interface UsageDocument {
    readonly format: 'model-tides';
    readonly version: 1;
    readonly source: string;
    readonly events: UsageEvent[];
}

export const MAX_EVENTS = 200_000;
export const MAX_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const MAX_DATE = 8_640_000_000_000_000;

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
    Object.keys(value).every((key) => allowed.includes(key));

const validTime = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_DATE;

const validModel = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 320 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

/** Reject extra fields so a mistaken export can never carry message bodies or identifiers. */
export function parseUsageDocument(input: unknown): UsageDocument {
    if (!object(input) || !onlyKeys(input, ['format', 'version', 'source', 'events']) ||
        (input.format !== 'model-tides' && input.format !== 'model-currents') || input.version !== 1 ||
        typeof input.source !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(input.source) ||
        !Array.isArray(input.events) || input.events.length > MAX_EVENTS) {
        throw new TypeError('Expected a Model Tides v1 metadata file.');
    }

    const events: UsageEvent[] = input.events.map((raw: unknown) => {
        if (!object(raw) || !onlyKeys(raw, ['time', 'model', 'kind', 'fromModel', 'fromTime']) ||
            !validTime(raw.time) || !validModel(raw.model)) {
            throw new TypeError('The metadata file contains an invalid usage event.');
        }
        if (raw.kind === 'session' && !('fromModel' in raw) && !('fromTime' in raw)) {
            return { time: raw.time, model: raw.model, kind: 'session' };
        }
        if (raw.kind === 'switch' && validModel(raw.fromModel) && validTime(raw.fromTime) && raw.fromTime <= raw.time) {
            return { time: raw.time, model: raw.model, kind: 'switch', fromModel: raw.fromModel, fromTime: raw.fromTime };
        }
        throw new TypeError('The metadata file contains an invalid usage event.');
    });

    return { format: 'model-tides', version: 1, source: input.source, events };
}
