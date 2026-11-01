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

The tag triggers the workflow. It builds the frontend again, builds all six binaries with `CGO_ENABLED=0`, and creates a **draft** GitHub Release with archives, `checksums.txt`, an SBOM per archive and a cosign signature of the checksums. Read the draft, then publish it. After the release commit, remove `web/dist` again on the next commit (`git rm -r --cached web/dist`, keep `.gitkeep`) so development diffs stay small.

`go install github.com/CirXe0N/natter/cmd/natter@vX.Y.Z` then serves the full UI. The version shown in the footer comes from `-X main.version` in release archives and from the module version otherwise.

## Check the config without releasing

Every pull request runs `goreleaser release --snapshot --skip=sign` in CI. Locally:

```sh
go run github.com/goreleaser/goreleaser/v2@v2.19.0 release --snapshot --clean --skip=sbom,sign
```

Use `--skip=sign` instead if `syft` is installed. Signing needs a CI identity and only runs on a tag.

## Verify a download

```sh
sha256sum -c checksums.txt --ignore-missing
cosign verify-blob checksums.txt --bundle checksums.txt.sigstore.json \
  --certificate-identity-regexp 'https://github.com/CirXe0N/natter/\.github/workflows/release\.yml@refs/tags/v.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

macOS and Windows warn about the unsigned binaries the first time they run. [Unsigned-binary warnings](desktop.md#unsigned-binary-warnings) says how to get past each warning.

## Third-party licences

`scripts/licenses.sh` writes `THIRD_PARTY_LICENSES.txt` (every linked Go module and production npm package) before each build, and every archive contains it.

## macOS notarization

The `notarize.macos` block in `.goreleaser.yaml` is off. It turns on when the `MACOS_SIGN_P12` secret is set, together with `MACOS_SIGN_PASSWORD`, `MACOS_NOTARY_ISSUER_ID`, `MACOS_NOTARY_KEY_ID` and `MACOS_NOTARY_KEY`. These need an Apple Developer ID, which does not exist yet.

## Trademark

NATS™ is a trademark of the Linux Foundation. Natter is an independent project and is not affiliated with or endorsed by the Linux Foundation, the CNCF or Synadia. Docs and release notes put ™ after the first mention of NATS (ADR-0004).
