#!/usr/bin/env python3
"""Export OpenCode model/timestamp events without exporting messages or session IDs."""

import json
import sqlite3
import sys
from pathlib import Path

MAX_EVENTS = 200_000
QUERY = """
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
"""


def export(database_path: Path) -> dict:
    previous = {}
    events = []
    with sqlite3.connect(database_path.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        connection.execute("PRAGMA query_only = ON")
        for session_id, message_time, session_time, provider, model_id in connection.execute(QUERY):
            if (not isinstance(provider, str) or not isinstance(model_id, str)
                    or not provider or not model_id or len(provider) > 100
                    or len(model_id) > 200 or type(message_time) is not int):
                continue
            model = f"{provider}/{model_id}"
            if model.strip() != model or any(ord(character) < 32 or ord(character) == 127 for character in model):
                continue
            prior = previous.get(session_id)
            if prior is None:
                time = session_time if type(session_time) is int and session_time <= message_time else message_time
                events.append({"time": time, "model": model, "kind": "session"})
                previous[session_id] = (model, time)
            elif prior[0] != model:
                events.append({"time": message_time, "model": model, "kind": "switch",
                               "fromModel": prior[0], "fromTime": prior[1]})
                previous[session_id] = (model, message_time)
            if len(events) > MAX_EVENTS:
                raise ValueError("Too many events")
    return {"format": "model-tides", "version": 1, "source": "opencode", "events": events}


if __name__ == "__main__":
    try:
        if len(sys.argv) > 2:
            raise ValueError("Expected one path")
        path = Path(sys.argv[1]).expanduser() if len(sys.argv) == 2 else Path.home() / ".local/share/opencode/opencode.db"
        print(json.dumps(export(path), separators=(",", ":"), ensure_ascii=False))
    except (OSError, sqlite3.Error, ValueError):
        print("Could not export OpenCode model metadata. Check the database path.", file=sys.stderr)
        sys.exit(1)
