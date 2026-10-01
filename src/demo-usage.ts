import type { UsageDocument, UsageEvent } from './usage-data';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A fixed synthetic seed makes the example repeatable without resembling a real history. */
function sample(day: number, session: number, salt: number): number {
    const seed = Math.imul(day + 1, 374_761_393) ^
        Math.imul(session + 1, 668_265_263) ^ Math.imul(salt + 1, 2_246_822_519);
    const mixed = Math.imul(seed ^ (seed >>> 13), 1_274_126_177);
    return ((mixed ^ (mixed >>> 16)) >>> 0) / 0x1_0000_0000;
}

/** Invented names and dates for a shareable example; no user data enters this fixture. */
export function makeDemoUsage(): UsageDocument {
    const phases = [
        ['anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4',
            'anthropic/claude-haiku-3', 'openai/gpt-5', 'openai/gpt-5', 'google/gemini-2.5-flash'],
        ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4', 'anthropic/claude-opus-4',
            'openai/gpt-5', 'openai/gpt-5-codex', 'openai/gpt-5-codex', 'deepseek/r1',
            'google/gemini-2.5-flash'],
        ['anthropic/claude-opus-4', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4',
            'openai/gpt-5', 'openai/gpt-5-codex', 'openai/gpt-5-codex',
            'google/gemini-2.5-flash', 'deepseek/r1', 'meta/llama-4', 'mistral/large'],
    ];
    const events: UsageEvent[] = [];
    const start = Date.UTC(2025, 0, 2);
    for (const day of Array.from({ length: 120 }, (_, index) => index)) {
        const date = start + day * DAY;
        const weekday = new Date(date).getUTCDay();
        const weekend = weekday === 0 || weekday === 6;
        const quiet = (day >= 45 && day <= 53) || (day >= 91 && day <= 97);
        if (quiet || sample(day, 0, 1) < (weekend ? 0.8 : 0.34)) continue;

        const models = phases[day < 37 ? 0 : day < 75 ? 1 : 2]!;
        const count = 1 + Math.floor(sample(day, 0, 2) * 3) + (sample(day, 0, 3) > 0.95 ? 2 : 0);
        for (const session of Array.from({ length: count }, (_, index) => index)) {
            const time = date + (7 + Math.floor(sample(day, session, 4) * 13)) * HOUR +
                Math.floor(sample(day, session, 5) * 60) * 60_000;
            const model = models[Math.floor(sample(day, session, 6) * models.length)]!;
            events.push({ time, model, kind: 'session' });
            const next = models[Math.floor(sample(day, session, 7) * models.length)]!;
            if (next !== model && sample(day, session, 8) > 0.77) {
                events.push({
                    time: time + (20 + Math.floor(sample(day, session, 9) * 180)) * 60_000,
                    model: next,
                    kind: 'switch', fromModel: model, fromTime: time,
                });
            }
        }
    }
    events.sort((left, right) => left.time - right.time);
    return { format: 'model-tides', version: 1, source: 'example', events };
}
