# Model Tides CLI

Run `npx model-tides@latest upload` to discover local OpenCode, Codex, and Claude Code history, review the exact weekly model counts, and choose whether to share them. Python 3 is needed for the local converters; old compressed Codex rollouts also need `zstd`.

To see your history without sharing it, run `npx model-tides@latest export --output model-tides.json`, then open the file at [modeltides.dev/local/](https://modeltides.dev/local/). Export works offline and never overwrites an existing file. The JSON contains exact event timestamps; keep it private.

Nothing is uploaded until you type `YES`. The CLI sends Brotli-compressed week/model/count pairs; it never sends prompts, responses, exact event times, paths, session IDs, message IDs, or the source databases. Your public link uses a separate local private replacement key, kept under `~/.config/model-tides/` (or `XDG_CONFIG_HOME`).

Before the preview, the CLI retrieves the public models.dev catalog through Model Tides without sending your model names or history. Models missing from the catalog are shown as excluded and stay local. The server checks uploaded model names again.

To use an exported metadata JSON, run `npx model-tides@1.0.1 upload --input model-tides.json`. Run `npx model-tides@1.0.1 upload --rotate` or `--delete` to manage your shared link. See [the project documentation](https://github.com/BYK/model-tides#share-a-weekly-snapshot-optional) for details.
