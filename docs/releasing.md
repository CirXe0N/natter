# Releasing Natter

Natter is a UI for NATS™. Releases are single binaries for Linux, macOS and Windows on amd64 and arm64, built by GoReleaser (`.goreleaser.yaml`) in `.github/workflows/release.yml`.

## Cut a release

`go install` never runs npm, so the built frontend has to be in the tagged commit. `web/dist` is gitignored on every other commit.

```sh
npm --prefix web ci && npm --prefix web run build
git add -f web/dist
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

The tag triggers the workflow. It builds the frontend again, builds all six binaries with `CGO_ENABLED=0`, and creates a **draft** GitHub Release with archives, `checksums.txt`, an SBOM per archive and a cosign signature of the checksums. Read the draft, then publish it.

While the repository is private, tag builds skip the cosign signature. Keyless signing records the repository's name, the tag and the commit in Sigstore's public transparency log, permanently, which would reveal the private repository. The workflow reads the repository's visibility, so signing starts by itself once it is public. After the release commit, remove `web/dist` again on the next commit (`git rm -r --cached web/dist`, keep `.gitkeep`) so development diffs stay small.

`go install github.com/CirXe0N/natter/cmd/natter@vX.Y.Z` then serves the full UI. The version shown in the footer comes from `-X main.version` in release archives and from the module version otherwise.

## Check the config without releasing

Every pull request runs `goreleaser release --snapshot --skip=sign` in CI. Locally:

```sh
go run github.com/goreleaser/goreleaser/v2@v2.19.0 release --snapshot --clean --skip=sbom,sign
```

Use `--skip=sign` instead if `syft` is installed. Signing needs a CI identity and only runs on a tag.

## Verify a download

`checksums.txt` is always there; the `.sigstore.json` signature only on releases made while the repository is public.

```sh
sha256sum -c checksums.txt --ignore-missing
cosign verify-blob checksums.txt --bundle checksums.txt.sigstore.json \
  --certificate-identity-regexp 'https://github.com/CirXe0N/natter/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

macOS and Windows warn about the unsigned binaries the first time they run. [Unsigned-binary warnings](desktop.md#unsigned-binary-warnings) says how to get past each warning.

## Desktop builds

The `desktop` jobs in the same workflow build the Wails desktop app (ticket 26) with `packaging/desktop.sh`, one native runner per OS because it needs cgo: DMG and zipped `.app` on macOS, installer and bare `.exe` on Windows, deb, rpm, AppImage and a tarball on Linux. On a tag, `desktop-publish` adds them to GoReleaser's draft release with `checksums-desktop.txt`. Pull requests build them too, as workflow artifacts.

Wails is pinned to an exact version in `go.mod`, and `packaging/desktop.sh` runs the `wails3` CLI at the same version. Change both together. Only `-tags desktop` compiles Wails in. `TestDefaultBuildHasNoWails` fails if the plain build ever depends on it.

`npm --prefix web run e2e:webkit` runs the end-to-end tests in WebKit, the engine the desktop app uses on macOS and Linux. The `e2e` workflow runs both engines. On distributions Playwright does not support, such as Arch, run the browser in its container and point the tests at it:

```sh
docker run -d --rm --name pw --network host --init mcr.microsoft.com/playwright:v1.64.1-noble \
  npx -y playwright@1.64.1 run-server --port 3123 --host 127.0.0.1
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3123/ npm --prefix web run e2e:webkit
```

### Update signing

The app installs only update manifests signed with the release key. Until the key exists, desktop builds ship with updates off. To turn them on, once:

```sh
go run github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0 updater genkey -out updater.key
```

- Store the contents of `updater.key` as the repository secret `UPDATER_SIGNING_KEY`, keep an offline backup, and delete the file. Without the key, apps already installed can't take another update.
- Store the base64 of the raw public key as the repository variable `UPDATER_PUBLIC_KEY`. `genkey` prints it. The build bakes it in with `-X main.updateKey`.

Each tagged release then gets an `update-manifest.json` that signs the zipped `.app`, the Windows `.exe` and the AppImage. Apps read `releases/latest/download/update-manifest.json`, so a draft reaches nobody until you publish it.

### AUR

`packaging/aur/PKGBUILD` is the `natter-bin` recipe. It installs the release's Linux tarball. For each release, set `pkgver`, put the tarball's checksum from `checksums-desktop.txt` in `sha256sums`, run `makepkg --printsrcinfo > .SRCINFO`, and push both files to the AUR repository.

## Third-party licences

`scripts/licenses.sh` writes `THIRD_PARTY_LICENSES.txt` (every linked Go module and production npm package) before each build, and every archive contains it. `packaging/desktop.sh` runs it with `GOFLAGS=-tags=desktop`, so the desktop packages list Wails and its dependencies too.

## macOS notarization

The `notarize.macos` block in `.goreleaser.yaml` is off. It turns on when the `MACOS_SIGN_P12` secret is set, together with `MACOS_SIGN_PASSWORD`, `MACOS_NOTARY_ISSUER_ID`, `MACOS_NOTARY_KEY_ID` and `MACOS_NOTARY_KEY`. These need an Apple Developer ID, which does not exist yet.

## Trademark

NATS™ is a trademark of the Linux Foundation. Natter is an independent project and is not affiliated with or endorsed by the Linux Foundation, the CNCF or Synadia. Docs and release notes put ™ after the first mention of NATS (ADR-0004).
