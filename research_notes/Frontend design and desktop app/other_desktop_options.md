# Non-Go-native desktop options for nats-ui, and "the web app is enough" alternatives (as of 2026-10-31)

Scope: Tauri v2 + Go sidecar, Electron + Go child, Qt/QML (native rewrite or Qt WebEngine shell), and browser-only options (PWA, Chromium `--app=`, Omarchy web-app launcher). Wails and other Go-native options are covered elsewhere. Project constraints come from [ADR 0001](file:///home/dwayne/Work/nats-ui/docs/adr/0001-go-backend-with-domain-api.md): one Go binary is the only way the app ships (GitHub Releases and `go install`), the server binds to localhost, and every request needs the Launch token session cookie plus the expected `Host` and `Origin`.

Local evidence: some findings come from the user's own Omarchy 4.5.0rc2 machine (pacman database, `/usr/bin/omarchy-*` scripts, `~/.local/state/omarchy/current/theme/`). These are marked "(local inspection)". They are primary sources, but they have no URL; the matching upstream repo is https://github.com/basecamp/omarchy.

## Tauri v2 with the Go binary as a sidecar

### Takeaway
It works without any change to the Go security model: Rust spawns the Go binary as an `externalBin` sidecar, reads its port and Launch token from stdout, and points the window at `http://127.0.0.1:PORT`. But it adds a Rust toolchain and per-OS installers, and on Linux you get either a 70+ MB AppImage or a small deb/rpm that needs the system's WebKitGTK. WebKitGTK also has documented Wayland and NVIDIA rendering problems. It is no longer "one download".

### Cited Findings
- Versions: tauri crate v2.12.5 and @tauri-apps/cli / tauri-cli v2.12.4 were released 21 Oct (2026). tauri v3.0.0-alpha.5 came out 14 Oct, so v3 is in alpha. — [GitHub tauri releases](https://github.com/tauri-apps/tauri/releases)
- Sidecar mechanism: sidecars are listed in `bundle.externalBin` in `tauri.conf.json` (e.g. `"binaries/my-sidecar"`). Each binary must exist with a `-$TARGET_TRIPLE` suffix, e.g. `my-sidecar-x86_64-unknown-linux-gnu`; get the triple with `rustc --print host-tuple` (Rust 1.84+). — [Tauri: Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- Spawning: from Rust, `app.shell().sidecar(name)` (tauri_plugin_shell::ShellExt). `spawn()` returns a receiver for events such as stdout, plus a child handle that can write to stdin. From JS, `Command.sidecar('binaries/my-sidecar')`. — [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- Permissions: JS-side spawning needs a capability such as `{"identifier":"shell:allow-execute","allow":[{"name":"binaries/my-sidecar","sidecar":true}]}`, or `shell:allow-spawn` for `spawn()`. Args can be static or regex-validated, and must match in order. — [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- Lifecycle: the sidecar page does not document killing the sidecar on app exit. The only handle it shows is the `child` from `spawn()`. — [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- Capability model: capabilities are JSON/TOML files in `src-tauri/capabilities` that grant permissions per window. "By default, only code bundled with the app can call the Tauri API". Remote origins get IPC only if listed under `remote.urls`. On Linux and Android, Tauri "cannot distinguish requests from an embedded `<iframe>` and the window itself". — [Tauri: Capabilities](https://v2.tauri.app/security/capabilities/)
- The localhost plugin serves the app's own assets over a local HTTP server instead of the custom protocol. Tauri warns it "brings considerable security risks and you should only use it if you know what you are doing… If in doubt, use the default custom protocol". It requires Rust 1.90+. — [Tauri localhost plugin](https://v2.tauri.app/plugin/localhost/)
- Updater: signatures are mandatory ("This cannot be disabled"), with a keypair from `signer generate`. TLS is enforced in production. Endpoints can be a static JSON (`version`, `platforms` keyed `OS-ARCH`, each with `url` and inline `signature`) or a dynamic server (204 when there is no update). With `createUpdaterArtifacts: true`, the updatable bundles are: Linux AppImage (+`.sig`), macOS `.app.tar.gz`, and Windows NSIS `-setup.exe` and `.msi`. The page documents no deb/rpm update path. — [Tauri updater plugin](https://v2.tauri.app/plugin/updater/)
- Linux AppImage: it "bundles all dependencies", so "the file size grows from the 2-6 MB range to 70+ MB". You must build on the oldest supported base (e.g. Ubuntu 22.04 / Debian 12 for WebKitGTK 4.1) or users may hit `GLIBC_2.33 not found`. ARM AppImages cannot be cross-compiled. GUI apps don't inherit `$PATH`. — [Tauri AppImage](https://v2.tauri.app/distribute/appimage/)
- WebKitGTK on Wayland: on some setups, mostly NVIDIA, WebKitGTK and the driver disagree, causing anything "from a blank window to subtle rendering problems". Most of this is blamed on the DMABUF renderer. The workarounds are `__NV_DISABLE_EXPLICIT_SYNC=1` (for Wayland "Error 71"), `WEBKIT_DISABLE_DMABUF_RENDERER=1` (loses the fast path), and, as a last resort, `WEBKIT_DISABLE_COMPOSITING_MODE=1`. Tauri warns against setting these unconditionally. The original reports are in tauri issue #9394. — [Tauri: Linux Graphics Issues](https://v2.tauri.app/develop/debug/linux-graphics/)
- Bundle size: I found no first-party Tauri number beyond the AppImage page's "2-6 MB" baseline. Third-party benchmarks report a Hello World of about 3.2 MB for Tauri vs 85 MB for Electron. — [tech-insider.org](https://tech-insider.org/tauri-vs-electron-2026/) (secondary; treat as approximate)

### Inferences
- For nats-ui, Tauri would be a thin shell around the Go server. The SPA already lives in the Go binary, so the window should load `http://127.0.0.1:PORT` from the Go server (`WebviewUrl::External`), not Tauri's custom protocol.
  - Result: the page's origin is the Go server's own origin, so the Host/Origin checks and the Launch token cookie work unchanged.
  - The page counts as "remote" to Tauri, so it gets no Tauri IPC. That is the safest setting, and nats-ui needs none.
  - Serving the SPA from `tauri://localhost` and calling Go cross-origin would instead force the Go Origin allowlist to change.
- The Launch token can be handed over in-process: Go prints `port` + token on stdout, Rust reads them from the sidecar's stdout event receiver and navigates to `http://127.0.0.1:PORT/?launch=TOKEN`. The token never needs to be shown to the user.
- Bundle size: the Go binary (likely tens of MB) dominates the deb/rpm/dmg/msi. On Linux, the AppImage adds 70+ MB of WebKitGTK. On macOS/Windows the OS webview (WKWebView/WebView2) keeps it small.
- "One download" is lost: you ship one artifact per OS/arch (AppImage or deb/rpm, dmg/.app, msi/nsis), each wrapping a per-triple Go sidecar, plus signing keys. `go install` stops being a way to get the desktop app. This contradicts ADR 0001's single-binary distribution.
- Wayland quality on Omarchy depends on the system WebKitGTK and the GPU driver. That is a weaker baseline than the Chromium the user already runs.
- Lifecycle: you must kill the Go child on window close yourself, and handle orphaning on crash, e.g. by having Go exit when its stdin closes. The docs don't promise automatic cleanup.

### Gaps
- No official Tauri statement that sidecars are killed automatically on app exit; this needs checking in the shell plugin API reference or issues.
- No official first-party bundle-size figure for a minimal Tauri app on macOS/Windows.
- No official word on whether deb/rpm installs can self-update through the updater plugin (only AppImage is documented).

## Electron with a Go child process

### Takeaway
Electron 45 has secure defaults (contextIsolation, sandbox, no nodeIntegration) and, since 38.2, native Wayland by default. But it ships a whole Chromium (tens to hundreds of MB) to show a UI the user's existing browser already renders. For a localhost console with no need for native APIs, it is not justified.

### Cited Findings
- Latest stable is Electron 45.2.1 (2026-10-30), with Chromium 156.0.8078.75 and Node 24.22.1. — [releases.electronjs.org](https://releases.electronjs.org/)
- Security defaults: nodeIntegration is off since Electron 5, contextIsolation is on since 12, and sandbox is on since 20. Setting `nodeIntegration: true` also disables isolation and sandbox for that renderer. — [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- The 20-item checklist includes: only load secure content, define a CSP, limit navigation (`will-navigate` + compare `URL.origin`, not `startsWith`), deny new windows via `setWindowOpenHandler`, validate the IPC sender, prefer custom protocols over `file://`, and check fuses. "By default, Electron approves all permission requests unless you set a custom handler" (`session.setPermissionRequestHandler`). — [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- Wayland: Chromium defaulted to Wayland in Aug 2025, and Electron did the same in late Sep 2025 ("out of the box in Electron 38.2 and newer").
  - Electron 41 added client-side decorations for all window types.
  - `setPosition` and `getCursorScreenPoint` are unsupported on Wayland.
  - `globalShortcut` and `desktopCapturer` depend on the desktop environment and portals.
  - Source: [Electron blog: Tech Talk Wayland, 2026-03-17](https://www.electronjs.org/blog/tech-talk-wayland)
- The `ELECTRON_OZONE_PLATFORM_HINT` env var is deprecated (planned breaking changes for 38), and `auto` is the default hint. — [electron PR mirror commit #48002](https://ayakael.net/mirrors/electron/commit/b9ceaabb857e0ec55c81b464facea77ebdddad44) (mirror of upstream docs)
- Size: third-party benchmarks report about 85 MB for an Electron Hello World and 244 MB for a larger app, versus single-digit MB for Tauri. — [tech-insider.org](https://tech-insider.org/tauri-vs-electron-2026/) (secondary). For comparison, Arch's system chromium 155 package is 431.10 MiB installed (local inspection, `pacman -Si chromium`).

### Inferences
- The same pattern as Tauri applies: `child_process.spawn` the Go binary, read the port and token from stdout, and `loadURL('http://127.0.0.1:PORT/?launch=…')` in a BrowserWindow with no preload.
  - The Go security model is then unchanged.
  - Electron itself adds the checklist burden: lock navigation to the Go origin and deny permission requests.
- electron-builder (AppImage/deb/rpm/dmg/nsis) plus electron-updater would give auto-update. That adds a Node build toolchain and code-signing, and loses the single binary and `go install`.
- Electron does not fit the ADR or Omarchy's minimalism: it is the largest bundle of any option and adds nothing a Chromium `--app=` window lacks for this app.

### Gaps
- electron-builder and electron-updater docs were not fetched in this pass (versions, Linux auto-update formats); I make no specific claims about them.
- No first-party Electron bundle-size figure was found.

## A native Qt/QML app in the Omarchy style (QML rewrite vs Qt WebEngine shell)

### Takeaway
Omarchy's own apps are tiny Qt Quick binaries (275–689 KiB) that read the live theme from `~/.local/state/omarchy/current/theme/colors.toml`. A QML rewrite of nats-ui would fit Omarchy perfectly, but it duplicates the whole React UI and is Arch/Omarchy-centric in practice. A Qt WebEngine shell around the existing SPA pulls in a roughly 283 MiB Chromium (qt6-webengine), can't be built statically, and gains little over a Chromium `--app=` window.

### Cited Findings
- Omarchy app structure (local inspection, `pacman -Qi`/`-Ql`):
  - Hype 0.6.0 (https://github.com/omacom/hype): 688.83 KiB installed. Depends on qt6-base>=6.9, qt6-declarative>=6.9, qt6-multimedia>=6.9, qt6-svg, ffmpeg, xdg-desktop-portal and others.
  - Monologue 0.3.1 (https://github.com/omacom/monologue): 311.49 KiB.
  - Omacut 0.7.2 (https://github.com/omacom/omacut): 275.46 KiB.
  - Each package installs only `/usr/bin/<app>`, a `.desktop` file, a scalable SVG icon and a license. Qt comes from system packages: qt6-base 6.12.0 (67.56 MiB) and qt6-declarative 6.12.0 (135.14 MiB).
- Theme following (local inspection): the active theme lives at `~/.local/state/omarchy/current/theme/`.
  - It holds `colors.toml`: `mode`, `accent`, `background`, `foreground`, `dark_/lighter_background`, named colors and `bright_*` variants.
  - It holds per-app files such as `chromium.theme` (an RGB triple, e.g. `26,27,38`), `vscode.json`, `obsidian.css` and `alacritty.toml`.
  - Alongside it are `theme.name` and `theme.generation` (a counter that changes on each switch).
  - Strings in the Hype binary reference `OMARCHY_PATH`, `/omarchy/current`, `/colors.toml` and `QT_QPA_PLATFORMTHEME`, which suggests the apps read `colors.toml` directly.
  - Upstream: [basecamp/omarchy](https://github.com/basecamp/omarchy).
- Qt WebEngine size on Arch: qt6-webengine 6.11.2 is 94.54 MiB to download and 282.86 MiB installed (local inspection, `pacman -Si qt6-webengine`).
- Qt WebEngine constraints:
  - "Static builds are not supported."
  - It does not compile with MinGW.
  - Apps are not Mac App Store compatible.
  - The Linux sandbox needs seccomp-bpf and user namespaces (it can be disabled with `QTWEBENGINE_DISABLE_SANDBOX=1`).
  - The platform-notes page fetched (doc-snapshots, dev branch) has no Wayland section.
  - Source: [Qt WebEngine Platform Notes](https://doc-snapshots.qt.io/qtwebengine/qtwebengine-platform-notes.html)

### Inferences
- **QML rewrite:**
  - What it takes:
    - Every nats-ui screen (stream and consumer browsers, KV, Live tail, Example messages, Context editor) gets reimplemented in QML/C++.
    - That QML client talks to the existing Go domain API over HTTP and WebSocket.
    - The Go binary runs as a child or a separate service.
  - Result: two frontends to maintain, or the React one is abandoned and the "web console" identity in GLOSSARY.md goes with it.
  - It follows the theme natively, the Omarchy way: read `colors.toml` and watch `theme.generation`.
  - Packaging is a PKGBUILD, which fits the user's omarchy-app skill.
  - macOS/Windows would need separate Qt deployment work (bundling Qt yourself, since there is no system Qt). That was not researched here.
- **Qt WebEngine shell:**
  - A ~100-line C++ host can spawn Go, read the port and token, and open `QWebEngineView` at `http://127.0.0.1:PORT/?launch=…`. The Go security model is unchanged because the page is same-origin with the server.
  - Costs: a ~283 MiB Chromium dependency (bundled per-app on macOS/Windows, since static builds are impossible) and a Chromium release cadence tied to Qt's. Omarchy theming would still have to be done in the web UI.
  - It gains nothing over Chromium `--app=` on Omarchy, where Chromium is already the web-app runtime.
- **Theme following without Qt:** the same `colors.toml` can be read by the Go backend and served as CSS custom properties (e.g. `/theme.css`). A file watch on `theme.generation` can push changes over the existing WebSocket. That gives every option, including the plain browser and PWA, live Omarchy theming at no packaging cost.

### Gaps
- I did not fetch the basecamp/omarchy or omacom/* source on GitHub. Whether the apps watch `colors.toml` live (and how) is inferred from binary strings and the user's description, not read from source.
- Qt WebEngine Wayland quality: no first-party Qt doc page on Wayland-specific issues was found in this pass. The Chromium version in Qt WebEngine 6.11/6.12 was not confirmed.
- The user's local omarchy-app skill file could not be located under `~/.claude` for cross-checking.

## "Just a browser": installable PWA, Chromium `--app=` launched by Go, and Omarchy web-app launchers

### Takeaway
These get roughly 80–90% of a desktop app at zero extra build cost and keep the single binary and the security model unchanged:
- `http://localhost` qualifies for PWA install.
- Chrome needs no service worker for menu install.
- Omarchy's own web-app convention is just a `.desktop` file that runs `chromium --app=URL`.

The one design problem is the Launch token. An OS-launched window can't read a token printed to a terminal, so the binary itself must be the launcher: start or attach to the server, then open `--app=http://127.0.0.1:PORT/?launch=TOKEN`. A stable port is needed if PWA install or cookie persistence matter.

### Cited Findings
- `http://localhost`, `127.0.0.0/8`, `::1`, and `*.localhost` are "potentially trustworthy", i.e. a secure context. — [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
- PWA install: "must be served using the `https` protocol, or from a local development environment using `localhost` or `127.0.0.1` — with or without a port number" (and `file://` does not qualify). — [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- Chromium-based browsers require these manifest members: `name` or `short_name`, `icons` with 192px and 512px icons, `start_url`, `display` and/or `display_override`, and `prefer_related_applications` absent or false. A service worker is "not a requirement for a PWA to be installable". — [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- Chrome's criteria also include user engagement (at least one click/tap and 30 s on the page) and "served over HTTPS". — [web.dev: install criteria](https://web.dev/articles/install-criteria). That page doesn't mention localhost; MDN's localhost exception above covers it.
- Chrome dropped the service-worker `fetch` handler requirement for the menu install option in Chrome 108 (mobile) and 112 (desktop). The automatic install prompt still requires a fetch handler. — [Chrome blog: update install criteria](https://developer.chrome.com/blog/update-install-criteria)
- Omarchy web-app convention (local inspection of `/usr/bin/omarchy-webapp-install`, `omarchy-launch-webapp` and `omarchy-webapp-window-class`; upstream [basecamp/omarchy](https://github.com/basecamp/omarchy)):
  - `omarchy-webapp-install [name url icon [custom-exec] [mime-types]]` writes `~/.local/share/applications/<Name>.desktop` with `Exec=omarchy-launch-webapp "<url>"`. It accepts http(s) only.
  - It supports a custom `Exec` as the 4th argument.
  - It adds `StartupWMClass=chrome-<host>_<path>-Default`. The port is stripped from the host, so the class is stable across ports.
  - `omarchy-launch-webapp` runs the default browser if it is Chrome/Brave/Edge/Opera/Vivaldi/Helium, otherwise Chromium, with `--app="$1"` via `uwsm-app`.
  - Arch chromium is version 155.0.8059.84 (local inspection, `pacman -Si chromium`).

### Inferences
- **Chromium `--app=` from the Go binary:** a `nats-ui open` (or default) mode can start the server, then exec the first Chromium-family browser found with `--app=http://127.0.0.1:PORT/?launch=TOKEN`. That gives a chromeless, separately-tiled Hyprland window.
  - On Omarchy, the binary can simply call `omarchy-launch-webapp`.
  - On macOS/Windows, fall back to Chrome/Edge `--app` or the default browser.
  - The token goes from process to process and is never shown to the user. Host and Origin are the server's own. Nothing in ADR 0001 changes.
  - Note: `--app` uses the user's normal browser profile, so the session cookie lives in that profile alongside other sites, as with any browser tab.
- **Omarchy launcher:** `omarchy-webapp-install "NATS UI" http://127.0.0.1:PORT <icon> "nats-ui open"` (custom Exec) gives a launcher entry with an icon and a stable window class.
  - A plain-URL entry without the custom Exec would fail when the server isn't running or the token has rotated.
  - nats-ui could offer `nats-ui install-desktop` to write this, or an equivalent XDG `.desktop` file on non-Omarchy Linux.
- **PWA:**
  - The origin includes the port, so installability, the installed app's identity and cookies all depend on a stable port. A random port per run breaks them, which argues for a fixed default port with fallback.
  - An installed PWA launches `start_url` without a token. It works only if the server is running and the session cookie is still valid, or if the server offers a token-free re-auth for the PWA. Re-auth would weaken the Launch token model, so it should not be added casually.
  - A manifest plus icons is cheap to add and harmless, but `--app=` launched by the binary is the more robust primary path.
- **Theme:** serve Omarchy `colors.toml` as CSS variables (see the Qt section). On non-Omarchy systems, fall back to `prefers-color-scheme`.
- **Limits compared with a "real" desktop app:**
  - No native menus or tray.
  - No OS-keyring access from the frontend, which doesn't matter: the Vault lives in Go.
  - Depends on a Chromium-family browser being installed for the chromeless window. Firefox has no `--app` equivalent (not verified here).
  - Updates stay as they are today (GitHub Releases, `go install`, or an AUR/PKGBUILD).

### Gaps
- Firefox desktop PWA/app-window support as of Oct 2026 was not researched.
- I did not verify whether Chrome's installability checks actually accept `http://127.0.0.1:PORT` in Chrome 155/156 (MDN says yes; web.dev only says HTTPS).
- macOS/Windows equivalents of the Omarchy launcher (e.g. a Chrome `--app` shortcut or Edge "install as app") were not researched in detail.

## Security-model preservation and decision matrix

### Takeaway
Every option that loads the UI from the Go server's own `http://127.0.0.1:PORT` origin keeps the Launch token, Host check and Origin check unchanged: browser/`--app`/PWA, Tauri with an external URL, Electron `loadURL`, and Qt WebEngine. Only serving the SPA from the shell's own scheme, or a QML rewrite, forces changes. **Recommendation:** stay with the single binary and add Chromium `--app=` auto-launch, an optional `.desktop` installer (Omarchy's `omarchy-webapp-install` with a custom Exec), a PWA manifest and Omarchy theme CSS. Of the non-Go shells, Tauri is the only one worth keeping in reserve; Electron and a Qt WebEngine shell are not justified, and a QML rewrite only makes sense if the web UI is abandoned.

### Cited Findings
- Tauri bundled code gets IPC by default, and remote origins get none unless whitelisted. — [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- Tauri warns about serving assets over localhost. — [Tauri localhost plugin](https://v2.tauri.app/plugin/localhost/)
- Electron approves all permission requests by default, and navigation must be restricted by origin. — [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- Localhost is a secure context and PWA-installable. — [MDN Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), [MDN Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- Size, updater and Wayland facts as cited in the sections above: [Tauri AppImage](https://v2.tauri.app/distribute/appimage/), [Tauri updater](https://v2.tauri.app/plugin/updater/), [Tauri Linux graphics](https://v2.tauri.app/develop/debug/linux-graphics/), [Electron Wayland](https://www.electronjs.org/blog/tech-talk-wayland), [Qt WebEngine notes](https://doc-snapshots.qt.io/qtwebengine/qtwebengine-platform-notes.html)

### Inferences

Decision matrix. The ratings are my judgement from the findings above; sizes are the extra bytes added on top of the Go binary.

| Criterion | Browser + `--app=` / PWA / Omarchy .desktop | Tauri v2 + Go sidecar | Electron 45 + Go child | Qt WebEngine shell + Go child | Native QML rewrite (Omarchy style) |
|---|---|---|---|---|---|
| Effort | Very low: launcher code, manifest, icons, theme CSS | Medium: Rust shell, per-triple sidecar builds, signing, CI matrix | Medium: Node shell, electron-builder, signing, security hardening | Medium: small C++ host, but Qt deployment per OS | Very high: full UI rewrite in QML/C++ |
| Added bundle size | ~0 (uses installed browser) | Linux deb/rpm: a few MB + system webkit2gtk; AppImage 70+ MB; macOS/Windows small (system webview) | Roughly 85–250 MB (Chromium bundled; third-party figures) | ~283 MiB qt6-webengine on Arch (system pkg); must bundle on macOS/Windows | ~0.3–0.7 MB binary on Arch (system Qt); Qt bundled on macOS/Windows |
| Single-binary fit (ADR 0001) | Full: still one Go binary and `go install` | Broken: per-OS installers wrapping the Go sidecar | Broken | Broken | Broken (two artifacts or a Qt app + Go) |
| Linux/Wayland quality | Chromium native Wayland (Omarchy's default web-app runtime) | WebKitGTK; documented NVIDIA/DMABUF/Error 71 issues | Native Wayland since 38.2; CSD since 41 | Chromium-based; Wayland not documented on fetched page | Best Omarchy fit (same stack as Hype/Monologue/Omacut) |
| macOS/Windows | Chrome/Edge `--app` or default browser | Good (WKWebView/WebView2) | Good | Possible, heavy deployment; no static builds; no Mac App Store | Possible, but Qt bundling/deployment is unresearched |
| Auto-update | Unchanged (Releases, `go install`, AUR/pacman) | Updater plugin: mandatory signatures; Linux AppImage only documented | electron-updater (not researched here) | None built in | pacman on Arch; nothing on macOS/Windows |
| Security model | Unchanged; token passed via the launch URL | Unchanged if the window loads the Go origin with no remote IPC; changes if the SPA is served via the Tauri scheme | Unchanged if `loadURL` targets the Go origin, plus the Electron checklist | Unchanged (same-origin page) | Must change: the client is not a browser, so token/Origin handling has to be redesigned for a native client (the server still has to defend against browsers) |
| Live Omarchy theme | Go serves `colors.toml` as CSS and pushes changes over the WebSocket | Same as browser | Same as browser | Same as browser | Native (read `colors.toml`) |

Ranking for nats-ui:
1. Browser-based single binary with `--app` launch, PWA manifest and Omarchy theme.
2. Wails (other researcher) or Tauri, only if a true app window with an installer is required.
3. Qt WebEngine shell.
4. Electron.

A QML rewrite is a separate product decision, not a packaging choice.

### Gaps
- Real nats-ui Go binary size was not measured, so the totals per option are relative, not absolute.
- No first-party benchmark comparing memory or startup across these shells for this app.
