# Model Tides metadata format (v1)

The local CLI and Python converters produce and read this private JSON document:

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

The CLI rejects extra fields and permits at most 200,000 events in a JSON file under 32 MB. It also accepts [Model Currents v1 JSON](MODEL-CURRENTS.md) and converts it in memory. Use `model-tides export` to save private metadata or `model-tides upload --input model-tides.json` to review and publish weekly counts. The JSON contains exact timestamps; never upload it to the website.

OpenCode databases can contain changes still in their live `-wal` file. The CLI reads committed changes from a read-only SQLite connection; the optional Python exporter does the same and writes only model assignments and times. The website never receives event metadata. The separate [opt-in weekly snapshot format](WEEKLY-SNAPSHOT.md) contains only week/model/count pairs.

The CLI and optional [`scripts/export-history.py`](scripts/export-history.py) convert local Codex and Claude Code JSONL into this format. Codex records the selected model in `turn_context` entries; Claude Code records the model on assistant messages. Both readers count the first observed model per main session and subsequent changes. They never write transcript text, paths, or session/message IDs to the output, and run without a network connection. See the [usage commands](README.md#keep-exact-time-metadata-private).
