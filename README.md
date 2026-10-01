# Model Tides 🌊

**Your models, over time.**

[Open Model Tides](https://modeltides.dev/) — a private model-usage timeline you can share as an image.

The app is static and runs in your browser. It has no account, backend or analytics. It never uploads your database or imported metadata. After one online visit, its built files and SQLite WASM module are available offline. Your imported data stays in the tab's memory; **Clear history** removes it.

The page follows your system's light or dark appearance. Use the theme button to switch for this visit; the share image uses the theme you see.

## Get started

1. Open the site and click **Choose a file**. Select your OpenCode `opencode.db` (normally `~/.local/share/opencode/opencode.db` on Linux). The browser accepts databases up to 256 MB.
2. For larger databases, or recent changes in a live SQLite `-wal` file, click **download the local exporter** on the site. In the folder containing the downloaded script, run `python3 export-model-tides.py > model-tides.json`. Open that JSON on the site. Python's standard library is the only requirement.
3. Adjust the timeline and click **Download share image**. The PNG shows the selected model names and counts, without sharing your database or exact event timestamps. **Use mock data** previews the chart without using your history.

### Codex and Claude Code

Download **the history converter** from the site, or use [`scripts/export-history.py`](scripts/export-history.py). In the folder containing the script, run either command:

```sh
python3 export-history.py codex > model-tides.json
python3 export-history.py claude-code > model-tides.json
```

Run one command, then open `model-tides.json` on the site. The converter uses `~/.codex/` (including `sessions/` and `archived_sessions/`) or `~/.claude/projects/` by default. Pass a local JSONL file or history directory after the harness name to choose a different location. Python's standard library handles plain JSONL; Codex also compresses old rollouts as `.jsonl.zst`, which the converter reads with the local `zstd` command. If it is missing, the converter stops rather than omitting old sessions. It reads history locally and copies only models and timestamps into the output. Session IDs and message IDs are used transiently to avoid double-counting and never enter the JSON; prompts, replies, and paths never enter it either. The converter never sends data anywhere, and the site keeps imported metadata in tab memory.

Codex uses recorded `turn_context` model selections; Claude Code uses main-thread assistant messages. Repeated records and subagent histories are excluded. Sessions without an observed model cannot be counted. The converter produces the same [Model Tides v1 JSON](MODEL-TIDES.md) as the OpenCode exporter. Other harnesses can generate this format locally as well. Existing [Model Currents v1 JSON](MODEL-CURRENTS.md) still imports.

## Develop

Requires Node.js 24 or newer.

```sh
npm ci
npm test
npm run dev
npm run build
```

The build emits `dist/`, including a service worker and bundled SQLite reader. GitHub Actions tests and deploys `dist/` to GitHub Pages on pushes to `main`. No GitHub secret or server-side database access is required. The timeline renderer is a dependency-free SVG module under `src/flow-svg/`.

Model Tides grew out of the [AG Studio × Information is Beautiful workshop starter](https://github.com/ag-grid/ag-studio-iib-workshop), but this repository contains the standalone visualization, with no AG Studio or AG Charts dependency.
