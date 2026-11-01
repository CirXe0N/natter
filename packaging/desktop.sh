#!/usr/bin/env bash
# Builds the desktop app (ticket 26) for the OS it runs on, and its installers,
# into dist/desktop. Run from the repo root after building web/dist. cgo
# needs native runners: Linux wants gtk4 and webkitgtk-6.0 development files.
#   VERSION     package version, e.g. 1.2.3 (default 0.0.0)
#   LDVERSION   version the app reports and updates from; empty turns updates off
#   UPDATE_KEY  base64 Ed25519 public key that update manifests are signed with
set -euo pipefail
VERSION=${VERSION:-0.0.0}
export VERSION
out=dist/desktop
mkdir -p "$out"
# Exact versions, matching go.mod's Wails.
wails() { go run github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0 "$@"; }
nfpm() { go run github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.48.0 "$@"; }
GOFLAGS=-tags=desktop scripts/licenses.sh # the desktop build links Wails too
build() { go build -tags desktop -trimpath -ldflags "-s -w ${LDEXTRA:-} -X main.version=${LDVERSION:-} -X main.updateKey=${UPDATE_KEY:-}" "$@" ./cmd/natter; }

case "$(go env GOOS)" in
linux)
	mkdir -p build/linux
	CGO_ENABLED=1 build -o build/linux/natter
	for p in deb rpm; do nfpm package -f packaging/nfpm.yaml -p "$p" -t "$out/"; done
	cp packaging/natter.desktop THIRD_PARTY_LICENSES.txt build/linux/
	cp web/public/icon-512.png build/linux/natter.png
	tar -czf "$out/natter-desktop_linux_amd64.tar.gz" -C build/linux natter natter.desktop natter.png THIRD_PARTY_LICENSES.txt
	wails generate appimage -binary build/linux/natter -icon build/linux/natter.png \
		-desktopfile build/linux/natter.desktop -outputdir build/appimage -builddir build/appimage
	mv build/appimage/*.AppImage "$out/natter-desktop_linux_amd64.AppImage"
	;;
darwin)
	app=build/mac/Natter.app
	mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" build/mac/natter.iconset build/mac/dmg
	for arch in arm64 amd64; do CGO_ENABLED=1 GOARCH=$arch build -o "build/mac/natter-$arch"; done
	lipo -create -output "$app/Contents/MacOS/natter" build/mac/natter-arm64 build/mac/natter-amd64
	sed "s/VERSION/$VERSION/g" packaging/Info.plist >"$app/Contents/Info.plist"
	cp THIRD_PARTY_LICENSES.txt "$app/Contents/Resources/"
	for s in 16 32 128 256 512; do
		sips -z $s $s web/public/icon-512.png --out "build/mac/natter.iconset/icon_${s}x${s}.png" >/dev/null
	done
	iconutil -c icns build/mac/natter.iconset -o "$app/Contents/Resources/natter.icns"
	codesign --force --deep --sign - "$app" # ad hoc: Apple silicon runs nothing unsigned
	ditto -c -k --keepParent "$app" "$out/natter-desktop_darwin_universal.zip"
	cp -R "$app" build/mac/dmg/
	ln -sf /Applications build/mac/dmg/Applications
	hdiutil create -volname Natter -srcfolder build/mac/dmg -ov -format UDZO "$out/natter-desktop_darwin_universal.dmg"
	;;
windows)
	mkdir -p build/windows
	LDEXTRA="-H windowsgui" build -o build/windows/natter.exe
	cp build/windows/natter.exe "$out/natter-desktop_windows_amd64.exe"
	makensis=$(command -v makensis || echo "/c/Program Files (x86)/NSIS/makensis.exe")
	"$makensis" -DVERSION="$VERSION" -DEXE="$(cygpath -w build/windows/natter.exe)" -DLICENSES="$(cygpath -w THIRD_PARTY_LICENSES.txt)" \
		-DOUT="$(cygpath -w "$out")\\natter-desktop_windows_amd64-setup.exe" packaging/natter.nsi
	;;
esac
