# Model Tides CLI

Run `npx model-tides@0.1.0 upload` to discover local OpenCode, Codex, and Claude Code history, review the exact weekly model counts, and choose whether to share them. Python 3 is needed for the local converters; old compressed Codex rollouts also need `zstd`.

Nothing is uploaded until you type `YES`. The CLI sends Brotli-compressed week/model/count pairs; it never sends prompts, responses, exact event times, paths, session IDs, message IDs, or the source databases. Your public link uses a separate local private replacement key, kept under `~/.config/model-tides/` (or `XDG_CONFIG_HOME`).

To use an exported metadata JSON, run `npx model-tides@0.1.0 upload --input model-tides.json`. Run `npx model-tides@0.1.0 upload --rotate` or `--delete` to manage your shared link. See [the project documentation](https://github.com/BYK/model-tides#share-a-weekly-snapshot-optional) for details.
