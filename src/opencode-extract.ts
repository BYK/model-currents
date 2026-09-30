import type { Database } from 'sql.js';
import { MAX_EVENTS, parseUsageDocument, type UsageDocument, type UsageEvent } from './usage-data.ts';

/** SQLite JSON functions select metadata fields; message bodies never leave SQLite. */
export function extractOpenCodeUsage(database: Database): UsageDocument {
    database.run('PRAGMA query_only = ON');
    const previous = new Map<string, { model: string; time: number }>();
    const events: UsageEvent[] = [];
    const statement = database.prepare(`
        SELECT message.session_id, message.time_created AS message_time,
               session.time_created AS session_time,
               json_extract(message.data, '$.providerID') AS provider_id,
               json_extract(message.data, '$.modelID') AS model_id
        FROM message
        INNER JOIN session ON session.id = message.session_id
        WHERE json_valid(message.data)
          AND json_extract(message.data, '$.role') = 'assistant'
          AND json_type(message.data, '$.providerID') = 'text'
          AND json_type(message.data, '$.modelID') = 'text'
        ORDER BY message.session_id, message.time_created, message.id
    `);

    try {
        while (statement.step()) {
            const row = statement.getAsObject();
            const { session_id: sessionId, message_time: messageTime, session_time: sessionTime,
                provider_id: provider, model_id: modelId } = row;
            if (typeof sessionId !== 'string' || typeof provider !== 'string' || typeof modelId !== 'string' ||
                !provider || !modelId || provider.length > 100 || modelId.length > 200 ||
                !Number.isSafeInteger(messageTime)) continue;
            const model = `${provider}/${modelId}`;
            if (model.trim() !== model || /[\u0000-\u001f\u007f]/.test(model)) continue;
            const prior = previous.get(sessionId);
            if (!prior) {
                const time = Number.isSafeInteger(sessionTime) && (sessionTime as number) <= (messageTime as number)
                    ? sessionTime as number : messageTime as number;
                events.push({ time, model, kind: 'session' });
                previous.set(sessionId, { model, time });
            } else if (prior.model !== model) {
                events.push({ time: messageTime as number, model, kind: 'switch', fromModel: prior.model, fromTime: prior.time });
                previous.set(sessionId, { model, time: messageTime as number });
            }
            if (events.length > MAX_EVENTS) throw new RangeError('This database has too many events for a browser import. Use the local export script.');
        }
    } finally {
        statement.free();
    }

    return parseUsageDocument({ format: 'model-tides', version: 1, source: 'opencode', events });
}
