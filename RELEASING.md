# Releasing the CLI

Craft publishes only the package in `cli/`. The repository root remains private.

## One-time setup

1. Install a GitHub App on `BYK/model-tides` with **Contents: read and write** and **Issues: read and write**. Add its ID as the `production` environment variable `APP_ID` and its private key as the `production` environment secret `APP_PRIVATE_KEY`. Craft needs the App token to create a release branch that triggers CI and to finish the release. The environment accepts protected branches only; the `Safety` ruleset protects `main` and requires the `build` check before merging.
2. On [npm's `model-tides` package settings](https://www.npmjs.com/package/model-tides/access), add a **GitHub Actions trusted publisher**: owner `BYK`, repository `model-tides`, workflow filename `publish.yml`, environment `production`, and **Allow npm publish**. The workflow uses a GitHub-hosted runner with OIDC; no npm publish token is needed. After an OIDC release succeeds, disallow traditional publish tokens in the npm package settings.

## Release

1. Run the GitHub **Release** workflow with `auto`. The categories in `.github/release.yml` assign major bumps to breaking changes, minor bumps to features, and patch bumps to fixes and other changes. Craft bumps only `cli/package.json` and opens a release request.
2. Wait for **CI / Build** on Craft's release branch. It runs the tests and build, then uploads the CLI-only `npm-tarball` artifact.
3. Review the release request and label it `accepted`. The **Publish** workflow checks out the corresponding release branch and runs pinned Craft with npm OIDC. Craft publishes the tarball and creates the GitHub Release.
4. Check the new version on npm and its provenance, then verify `npx model-tides@<version> export --output model-tides.json` with synthetic local history. The export command never uploads anything. Only `upload` can send counts, after an explicit `YES`.

When a Worker change introduces new CLI endpoints, replace the homepage's `@latest upload` command with the browser link before deploying. Merge the tested PR and confirm the protected production migration and deployment before preparing the CLI release. The previous CLI still uses the old private-report path, which explicitly contributes to the aggregate; it cannot create the new personal-only report. Restore the homepage command only after npm resolves to the new version and a synthetic **released CLI** personal upload, chart, owner-read, opt-in/withdrawal, and delete pass. Never use private history for the release check.

The release workflows never cache dependencies. `package-manager-cache: false` is set for each release build.
