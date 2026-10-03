# Releasing the CLI

Craft publishes only the package in `cli/`. The repository root remains private.

## One-time setup

1. Install a GitHub App on `BYK/model-tides` with **Contents: read and write** and **Issues: read and write**. Add its ID as the `production` environment variable `APP_ID` and its private key as the `production` environment secret `APP_PRIVATE_KEY`. Craft needs the App token to create a release branch that triggers CI and to finish the release. The environment accepts protected branches only; the `Safety` ruleset protects `main` and requires the `build` check before merging.
2. On [npm's `model-tides` package settings](https://www.npmjs.com/package/model-tides/access), add a **GitHub Actions trusted publisher**: owner `BYK`, repository `model-tides`, workflow filename `publish.yml`, environment `production`, and **Allow npm publish**. The workflow uses a GitHub-hosted runner with OIDC; no npm publish token is needed. After an OIDC release succeeds, disallow traditional publish tokens in the npm package settings.

## Release

1. Run the GitHub **Release** workflow with `auto`. The categories in `.github/release.yml` assign major bumps to breaking changes, minor bumps to features, and patch bumps to fixes and other changes. Craft bumps only `cli/package.json` and opens a release request.
2. Wait for **CI / Build** and **CI / Build standalone** on Craft's release branch. CI runs tests and builds the npm package, then Fossilize builds Linux/macOS x64/arm64 executables with Node 24. Each native binary reads a synthetic SQLite fixture; the bundle job verifies four binaries and publishes `SHA256SUMS`. Review the CLI-only `npm-tarball` and `standalone` artifacts before approval.
3. Review the release request and label it `accepted`. The **Publish** workflow checks out the corresponding release branch and runs pinned Craft with npm OIDC. Craft publishes the tarball and attaches the four binaries and `SHA256SUMS` to the GitHub Release.
4. Check the new version on npm and its provenance, all six GitHub release assets, and the binaries' SHA-256 digests. Then verify `npx model-tides@<version> export --output model-tides.json` with synthetic local history. The export command never uploads anything. Only `upload` can send counts, after an explicit `YES`.

When a Worker change introduces new CLI endpoints, link to the project instructions instead of advertising an unverified `@latest upload` command. Merge the tested PR and confirm the protected production migration and deployment before preparing the CLI release. The previous CLI still uses the old private-report path, which explicitly contributes to the aggregate; it cannot create the new personal-only report. Advertise the homepage command only after npm resolves to the new version and a synthetic **released CLI** personal upload, chart, owner-read, opt-in/withdrawal, and delete pass. Never use private history for the release check.

The release workflows never cache dependencies. `package-manager-cache: false` is set for each release build.

The standalone installer is served from `https://modeltides.dev/install.sh`. It downloads a release binary and its checksum to a temporary directory, checks SHA-256, then installs it under `~/.local/bin`. `curl -fsSL https://modeltides.dev/install.sh | bash` follows the latest published release; `curl -fsSL https://modeltides.dev/install.sh | MODEL_TIDES_VERSION=1.2.0 bash` pins the tested version shown on the homepage. Update that pinned homepage version only after the new GitHub Release contains all expected binary assets and a synthetic install check passes.
