# Model Currents

[Open Model Currents](https://byk.github.io/model-currents/) — a private model-usage timeline you can share as an image.

The app is static and runs in your browser. It has no account, backend or analytics. It never uploads your database or imported metadata. After one online visit, its built files and SQLite WASM module are available offline. Your imported data stays in the tab's memory; **Clear history** removes it.

## Get started

1. Open the site and click **Choose a file**. Select your OpenCode `opencode.db` (normally `~/.local/share/opencode/opencode.db` on Linux). The browser accepts databases up to 256 MB.
2. For larger databases, or recent changes in a live SQLite `-wal` file, click **download the local exporter** on the site. In the folder containing the downloaded script, run `python3 export-model-currents.py > model-currents.json`. Open that JSON on the site. Python's standard library is the only requirement.
3. Adjust the timeline and click **Download share image**. The PNG shows the selected model names and counts, without sharing your database or exact event timestamps. **Try invented data** previews the chart without using your history.

### Codex and Claude Code

**Their native history files are not imported directly yet.** The site accepts the same [Model Currents v1 JSON](MODEL-CURRENTS.md) from *any* harness, including Codex and Claude Code, if a local adapter or agent generates it. An example instruction for a local agent:

> Read only timestamps and model identifiers from my local Codex or Claude Code history. Write a Model Currents v1 JSON file following `MODEL-CURRENTS.md`. Count the first observed model in each session as a session start, and record later model changes as switches. Do not include prompts, replies, paths, tokens, message IDs or session IDs. Do not upload my history.

Check the resulting JSON locally before opening it. Different harnesses record session starts and model changes differently; a claimed importer must test its mapping against that harness's own file format. This repository ships a tested native OpenCode adapter and a strict, harness-neutral JSON reader.

## Develop

Requires Node.js 24 or newer.

```sh
npm ci
npm test
npm run dev
npm run build
```

The build emits `dist/`, including a service worker and bundled SQLite reader. GitHub Actions tests and deploys `dist/` to GitHub Pages on pushes to `main`. No GitHub secret or server-side database access is required. The timeline renderer is a dependency-free SVG module under `src/flow-svg/`.

Model Currents grew out of the [AG Studio × Information is Beautiful workshop starter](https://github.com/ag-grid/ag-studio-iib-workshop), but this repository contains the standalone visualization, with no AG Studio or AG Charts dependency.
