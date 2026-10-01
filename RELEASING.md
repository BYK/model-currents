# Releasing the CLI

Craft publishes only the package in `cli/`. The repository root remains private.

## One-time setup

1. Install a GitHub App on `BYK/model-tides` with **Contents: read and write** and **Issues: read and write**. Add its ID as the repository variable `APP_ID` and its private key as the repository secret `APP_PRIVATE_KEY`. Craft needs the App token to create a release branch that triggers CI and to finish the release.
2. On [npm's `model-tides` package settings](https://www.npmjs.com/package/model-tides/access), add a **GitHub Actions trusted publisher**: owner `BYK`, repository `model-tides`, workflow filename `publish.yml`, environment `production`, and **Allow npm publish**. The workflow uses a GitHub-hosted runner with OIDC; no npm publish token is needed. After an OIDC release succeeds, disallow traditional publish tokens in the npm package settings.

## Release

1. Run the GitHub **Release** workflow with a version. Use `1.0.2` for the first Craft release; later releases can use `auto`. Craft bumps only `cli/package.json` and opens a release request.
2. Wait for **CI / Build** on Craft's release branch. It runs the tests and build, then uploads the CLI-only `npm-tarball` artifact.
3. Review the release request and label it `accepted`. The **Publish** workflow checks out the corresponding release branch and runs pinned Craft with npm OIDC. Craft publishes the tarball and creates the GitHub Release.
4. Check the new version on npm, then verify `npx model-tides@<version> export --output model-tides.json` with synthetic local history. The export command never uploads anything. Only `upload` can share counts, after an explicit `YES`.

The release workflows never cache dependencies. `package-manager-cache: false` is set for each release build.
