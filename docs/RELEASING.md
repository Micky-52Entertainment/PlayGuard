# Releasing PlayGuard

A release is the installers for macOS (Apple chip and Intel) and Windows on the
[Releases](https://github.com/Micky-52Entertainment/PlayGuard/releases) page.
The installed apps check that page: once a release is published, Windows copies
update themselves on quit and Mac copies say a new version is out.

GitHub Actions builds the installers ([`.github/workflows/release.yml`](../.github/workflows/release.yml)); nothing has to be built on your computer.

## Steps

1. **Version.** Set the new version in [`apps/desktop/package.json`](../apps/desktop/package.json):

   ```bash
   npm version 1.2.0 --no-git-tag-version --prefix apps/desktop
   ```

2. **CHANGELOG.** In [`CHANGELOG.md`](../CHANGELOG.md), rename `## Unreleased` to `## 1.2.0 — 14 October 2026` and start a new empty `## Unreleased` above it. That section becomes the "What's new" part of the release page. To preview the page:

   ```bash
   node apps/desktop/scripts/release-notes.mjs 1.2.0
   ```

3. **Commit to `main`** and push. The Check workflow runs the typecheck and the tests.

4. **Tag** that commit and push the tag:

   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```

   The tag has to match the version in `apps/desktop/package.json`, and CHANGELOG has to have its section, or the build stops right away.

5. **Wait for the build** (Actions → Release, about half an hour). Each installer is started once on its own system before it is uploaded. The result is a **draft** release with the installers, the update files and a page that says which file to download, how to open it the first time, and what changed.

6. **Publish.** Open the draft on the Releases page, read it, press **Publish release**. From that moment the installed apps offer the update and the download links in the README lead to it.

A tag that was pushed by mistake: delete the draft release and the tag (`git push origin :refs/tags/v1.2.0`) before publishing. Never reuse a published version number: the installed apps would not see the change.

## Trying a build without releasing

Actions → Release → **Run workflow** builds every installer from the chosen branch without publishing anything. They are attached to the run as artifacts (`playguard-macos-14`, `playguard-macos-15-intel`, `playguard-windows-latest`).

On your own Mac or Windows computer:

```bash
cd apps/desktop
npm ci
npm run dist     # the installer for this computer, into apps/desktop/release
npm start        # the app from the source, without an installer
```

## Signing

The installers are not signed with a paid certificate yet. The Mac app is signed ad hoc, which lets a downloaded copy open through **Open Anyway** (unsigned, macOS would call it "damaged"). Windows shows SmartScreen once. [INSTALL.md](INSTALL.md) walks users through both.

To sign properly, add these repository secrets and remove `identity: "-"` and `hardenedRuntime: false` from [`apps/desktop/electron-builder.yml`](../apps/desktop/electron-builder.yml):

| Secret | What |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | The Developer ID Application certificate (.p12, base64) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | For notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | A Windows code signing certificate |

Then pass them to the "Build installers" step as `env`.
