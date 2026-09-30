import type { UsageDocument, UsageEvent } from './usage-data';

/** Invented names and dates for a shareable example; no user data enters this fixture. */
export function makeDemoUsage(): UsageDocument {
    const models = [
        'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-3',
        'openai/gpt-5', 'openai/gpt-5-codex', 'google/gemini-2.5-flash',
        'deepseek/r1', 'meta/llama-4', 'mistral/large',
    ];
    const events: UsageEvent[] = [];
    for (const [week, model] of models.entries()) {
        for (const period of Array.from({ length: 12 }, (_, index) => index)) {
            const time = Date.UTC(2025, 0, 2 + 7 * period + week % 5);
            events.push({ time, model, kind: 'session' });
            if (period % 3 === 0) {
                events.push({
                    time: time + 86_400_000,
                    model: models[(week + 1) % models.length]!,
                    kind: 'switch', fromModel: model, fromTime: time,
                });
            }
        }
    }
    return { format: 'model-tides', version: 1, source: 'example', events };
}
