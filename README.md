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

Import real history into the [private timeline](https://modeltides.dev/local/), then click **Upload weekly counts**. The browser shows the exact weekly model counts before upload. The updated CLI will also discover local OpenCode, Codex, and Claude Code history, show the counts, and ask you to type `YES`; use it after its release is verified. Both routes upload every reviewed model name, including older versions and provider-specific aliases; no current model catalog can verify self-reported use. Only the reviewed week/model/count pairs leave your device, Brotli-compressed; no transcripts, exact event times, paths, session IDs, or imported files are sent. The counts contribute to the community aggregate. A new personal report starts private; replacing weeks in an already public report makes the reviewed counts public immediately. The Worker validates the snapshot before storing it and returns a UUIDv7 ID and a separate private key. The CLI saves the key locally; in the browser, download it before closing the tab. Loading it back into the site lets you replace weeks or manage your contribution. The site never stores the key in browser storage.

Run `npx model-tides@latest share` or use **Share personal report** in the browser to publish your weekly counts at `/u/<id>`; this is a separate choice after uploading. Run `unshare` or **Hide personal report** to remove the page and its image without removing your counts from the aggregate. Use **Manage contribution** at `/local/` to load your key even after clearing your history. `link` prints the report address offline, but the address works only while shared. Links created before this change remain public until their owners hide them. As another way to share only reviewed weekly counts, run `npx model-tides@latest gist` (or `gist --input model-tides.json`) with an authenticated GitHub CLI. It shows the counts and asks for `YES` before creating an **unlisted** gist. The CLI prints a `modeltides.dev/gist#<owner>/<id>` viewer link: each visitor's browser fetches the weekly JSON directly from GitHub and validates it locally. The Model Tides Worker serves only `/gist` and receives neither the gist address nor its contents. GitHub sees gist requests. Anyone with the link can read the counts, and GitHub keeps revisions; the gist never contains exact event times.

Before publishing a personal report, both clients show every stored week, including weeks retained from earlier uploads. The Worker rejects sharing if counts change after review.

The same local uploader also runs from a repository checkout:

```sh
npm ci
npm run contribute
# Or use a metadata JSON you exported earlier:
npm run contribute -- --input model-tides.json
# Show the public URL again without scanning history:
npm run contribute -- link
# Publish or hide your personal report without changing the aggregate:
npm run contribute -- share
npm run contribute -- unshare
# Or create an unlisted GitHub gist of reviewed weekly counts:
npm run contribute -- gist --input model-tides.json
# Rotate the saved private key or delete the contribution:
npm run contribute -- --rotate
npm run contribute -- --delete
```

The npm package contains only the uploader, local Python converters, and metadata validator. It has no runtime npm dependencies. [Craft releases](RELEASING.md) publish the CLI through npm trusted publishing.

The CLI stores the private replacement key in `~/.config/model-tides/contribution.json` (or under `XDG_CONFIG_HOME`) with owner-only permissions. A second upload replaces matching contributor-weeks instead of incrementing them. Shared personal links show weekly names and counts immediately, with live Open Graph PNG previews. The home page shows a global timeline; each model-week needs at least five contributors to appear. Until then, it shows labeled mock data. Contributions are self-reported, and separate identities can upload overlapping histories. The offline local view remains available without contributing. Mock data cannot be contributed.

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

GitHub Actions tests each push and pull request; passing pushes to protected `main` apply D1 migrations before deploying through the `production` environment. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_ID` as environment variables, and `CLOUDFLARE_API_TOKEN` (Workers editing) and `CLOUDFLARE_D1_TOKEN` (D1 editing) as separate environment secrets. With an authenticated Cloudflare CLI, apply `migrations/` before running `npm run deploy` manually. `cloudflare.config.ts` configures the production and staging D1 databases, rate limiting, and the apex and `www` domains; the Worker redirects HTTP and `www` to the HTTPS apex. The timeline renderer is a dependency-free SVG module under `src/flow-svg/`.

Model Tides grew out of the [AG Studio × Information is Beautiful workshop starter](https://github.com/ag-grid/ag-studio-iib-workshop), but this repository contains the standalone visualization, with no AG Studio or AG Charts dependency.
