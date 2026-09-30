# Model Tides metadata format (v1)

The static site accepts a local OpenCode `.db` or this portable JSON document:

```json
{
  "format": "model-tides",
  "version": 1,
  "source": "opencode",
  "events": [
    { "time": 1735689600000, "model": "anthropic/claude-sonnet-4", "kind": "session" },
    { "time": 1735693200000, "model": "openai/gpt-5", "kind": "switch",
      "fromModel": "anthropic/claude-sonnet-4", "fromTime": 1735689600000 }
  ]
}
```

`time` and `fromTime` are UTC Unix milliseconds as integers. `model` uses `provider/model-id` where available. `source` is a lowercase adapter name, such as `opencode`, `codex`, or `claude-code`. The first observed model in a session creates a `session` event dated at the session start; subsequent model changes create `switch` events. `fromModel` and `fromTime` describe when the previous model started in that session. Repeated turns using the same model add no events. Session or message IDs, prompts, and replies never enter exported files.

The reader rejects extra fields and permits at most 200,000 events in a JSON file under 32 MB. It also accepts [Model Currents v1 JSON](MODEL-CURRENTS.md) and converts it in memory. Use **Export metadata JSON** to save a previously imported document, and **Download share image** for public sharing. The JSON contains model names and exact timestamps; the PNG contains visible model names and counts only.

OpenCode databases can contain changes still in their live `-wal` file. The browser receives only the selected `.db`, so use the bundled Python exporter for a complete live snapshot. It opens SQLite read-only and exports only model assignments and times. No model history is transmitted to the website or cached by its service worker.

The bundled `export-history.py` converts local Codex and Claude Code JSONL into this format. Codex records the selected model in `turn_context` entries; Claude Code records the model on assistant messages. Both converters count the first observed model per main session and subsequent changes. The script never writes transcript text, paths, or session/message IDs to the output, and runs without a network connection. See the [usage commands](README.md#codex-and-claude-code).
