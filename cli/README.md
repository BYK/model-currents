# Model Tides CLI

Run `npx model-tides@latest upload` to discover local OpenCode, Codex, and Claude Code history, review the exact weekly model counts, and choose whether to share them. Python 3 is needed for the local converters; old compressed Codex rollouts also need `zstd`.

To see your history without sharing it, run `npx model-tides@latest export --output model-tides.json`, then open the file at [modeltides.dev/local/](https://modeltides.dev/local/). Export works offline and never overwrites an existing file. The JSON contains exact event timestamps; keep it private.

Nothing is uploaded until you type `YES`. The CLI sends Brotli-compressed week/model/count pairs; it never sends prompts, responses, exact event times, paths, session IDs, message IDs, or the source databases. Review the model names in the preview: historical names and provider-specific aliases are shared exactly as shown. Your public link uses a separate local private replacement key, kept under `~/.config/model-tides/` (or `XDG_CONFIG_HOME`).

After uploading, the CLI prints your public report URL. Run `npx model-tides@latest link` to print it again without scanning history or contacting the site. The homepage displays a model-week only after five contributors share that model and week; your public report shows your own counts immediately.

To use an exported metadata JSON, run `npx model-tides@latest upload --input model-tides.json`. Run `npx model-tides@latest upload --rotate` or `--delete` to manage your shared link. See [the project documentation](https://github.com/BYK/model-tides#share-a-weekly-snapshot-optional) for details.
