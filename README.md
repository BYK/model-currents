# Model Tides 🌊

**Your models, over time.**

[Open Model Tides](https://modeltides.dev/) — explore shared weekly model counts or view your own history privately.

Your own timeline runs in your browser. It never uploads your database or imported metadata automatically. After one online visit, its built files and SQLite WASM module are available offline. Imported history stays in the tab's memory; **Clear history** removes it. The home page also reads public, self-reported weekly counts from a Cloudflare Worker. There is no account or analytics.

The page follows your system's light or dark appearance. Use the theme button to switch for this visit; the share image uses the theme you see.

## Get started

1. Open the [private timeline](https://modeltides.dev/local/) and click **Choose a file**. Select your OpenCode `opencode.db` (normally `~/.local/share/opencode/opencode.db` on Linux). The browser accepts databases up to 256 MB.
2. For larger databases, or recent changes in a live SQLite `-wal` file, click **download the local exporter** there. In the folder containing the downloaded script, run `python3 export-model-tides.py > model-tides.json`. Open that JSON in the private timeline. Python's standard library is the only requirement.
3. Adjust the timeline and click **Download share image**. The PNG shows the selected model names and counts, without sharing your database or exact event timestamps. **Use mock data** previews the chart without using your history.

## Share a weekly snapshot (optional)

Run `npx model-tides@1.0.1 upload` to discover local OpenCode, Codex, and Claude Code history. The CLI shows the exact weekly model counts and asks you to type `YES` before sharing anything. Alternatively, click **Contribute weekly counts** after importing real history into the [private timeline](https://modeltides.dev/local/). Both routes check model names against [models.dev](https://models.dev/) without sending it your model names or history. Names missing from its current catalog stay local and are shown as excluded before you confirm. Only the reviewed week/model/count pairs leave your device, Brotli-compressed; no transcripts, exact event times, paths, session IDs, or imported files are sent. The Worker checks the names again before storing them. The response contains a public UUIDv7 link and a separate private key. Download the key immediately and keep it private. Loading it back into the site lets you replace the same weeks, rotate the key, or delete the link. The site never stores the key in browser storage.

The same local uploader also runs from a repository checkout:

```sh
npm ci
npm run contribute
# Or use a metadata JSON you exported earlier:
npm run contribute -- --input model-tides.json
# Rotate the saved private key or delete the contribution:
npm run contribute -- --rotate
npm run contribute -- --delete
```

The npm package contains only the uploader, local Python converters, and metadata validator. It has no runtime npm dependencies. CLI release tags use `.github/workflows/publish-cli.yml` with npm trusted publishing once the trusted-publisher connection is configured.

The CLI stores the private replacement key in `~/.config/model-tides/contribution.json` (or under `XDG_CONFIG_HOME`) with owner-only permissions. A second upload replaces matching contributor-weeks instead of incrementing them. Public links show weekly names and counts, and have live Open Graph PNG previews. The home page shows a global timeline; each model-week needs at least five contributors to appear. Contributions are self-reported, and separate identities can upload overlapping histories. The offline local view remains available without contributing. Mock data cannot be contributed.

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

The build emits `dist/`, including a service worker and bundled SQLite reader. A Cloudflare Worker serves static assets, validates opt-in weekly uploads, stores public counts in D1, renders public pages and Open Graph images, and serves aggregate counts. It never receives a database or imported metadata JSON. GitHub Actions tests pushes and pull requests.

GitHub Actions tests each push and pull request; pushes to `main` apply D1 migrations before deploying. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID` as repository variables, and `CLOUDFLARE_API_TOKEN` (Workers editing) and `CLOUDFLARE_D1_TOKEN` (D1 editing) as separate repository secrets. With an authenticated Cloudflare CLI, apply `migrations/` before running `npm run deploy` manually. `cloudflare.config.ts` configures the production and staging D1 databases, rate limiting, and the apex and `www` domains; the Worker redirects HTTP and `www` to the HTTPS apex. The timeline renderer is a dependency-free SVG module under `src/flow-svg/`.

Model Tides grew out of the [AG Studio × Information is Beautiful workshop starter](https://github.com/ag-grid/ag-studio-iib-workshop), but this repository contains the standalone visualization, with no AG Studio or AG Charts dependency.
