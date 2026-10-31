# Go-native desktop options for nats-ui (as of 2026-10-31)

Scope: ship the existing Go backend plus the embedded React/Vite SPA in a native window, with as little duplication as possible, ideally still one binary. Targets: Omarchy (Arch, Hyprland, Wayland), macOS and Windows. Method: GitHub API (releases, issues, go.mod files), a sparse clone of `wailsapp/wails` at tag `v3.0.0` (source and the docs source under `docs/mpress/content`), a clone of `nats-nui/nui` at commit `71d1487c47cc`, and vendor docs. **wails.io returns HTTP 403 to automated fetches**, so Wails docs are cited from their source files in the repo at the `v3.0.0` tag. Each one carries a `slug:` equal to its wails.io path, for example `guides/server-build.md` → `https://wails.io/guides/server-build/`.

Local facts about the user's machine, observed with shell commands rather than cited: Hyprland 0.56.2 on a Wayland session, an **NVIDIA GeForce RTX 2080 with the `nvidia` kernel module loaded**, and `webkit2gtk-4.1 2.54.1` installed. Arch `extra` offers `webkitgtk-6.0 2.54.1` and `gtk4 4.24.1`, and `pacman -Si webkit2gtk` (the 4.0 API) finds no package.

## Q1. Wails v3: release status, architecture, reuse of net/http and WebSocket, features, packaging, one binary for two modes

### Takeaway
**Wails v3.0.0 has been stable since 2026-10-26, five days before this note.** It was preceded by beta.0 through beta.34 (August to October 2026) and nearly four years of alphas, and v3.1.0 nightlies are already out. Wails' asset server is an in-process `http.Handler` chain behind a custom scheme, not a TCP listener. Existing REST handlers mount on it unchanged, but **WebSocket upgrades are rejected with 501, cookies do not work on the custom scheme, and on Windows responses are fully buffered**. So nats-ui's `/ws` and session-cookie middleware do not carry over as they are. Wails' own "server mode" is a compile-time build tag, so it does not give one binary with both modes.

### Cited Findings
**Release status and cadence**
- v3.0.0 was published 2026-10-26 as a non-prerelease. It followed v3.0.0-beta.0 (2026-08-02) through beta.34 (2026-10-20), and `v3.1.0-nightly.20261027/28` already exist — [GitHub releases](https://github.com/wailsapp/wails/releases).
- The release notes say: "It has been nearly four years since the first v3 alpha in January 2023". They require **Go 1.26 or newer** and recommend 1.26.10 or 1.27.3 — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0).
- From now on, "weekly releases bump the minor version (v3.1.0, v3.2.0…)", nightlies are `v3.1.0-nightly.YYYYMMDD`, hotfixes bump the patch, and the notes say "Pin an exact version in production builds". The `@wailsio/runtime` npm package always has the same version as the Wails release — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0).
- Security: "This release fixes every published Wails v3 security advisory except one: GHSA-2p5f-2gx8-mh8m is only partly fixed." On Linux, a same-origin child frame (`srcdoc`/`about:blank` iframe) can still reach the native message handler. "On all platforms: bound-method calls from child frames go over HTTP to `/wails/runtime`… Treat any iframe you embed as having access to your bound Go methods." Upgrade advice applies to anyone on `v3.0.0-beta.30` or earlier — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0).
- Mobile (iOS and Android) is "experimental", is "not yet covered by the stability promise", and on Android the `window.wails` bridge is exposed to every frame — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0).

**Architecture: bindings vs the asset server**
- `AssetOptions` takes `Handler http.Handler` ("serves all the content to the WebView") and `Middleware` ("allows to skip the default request handler dynamically, e.g. implement specialized Routing") — [internal/assetserver/options.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/options.go).
- The WebView loads from a custom origin: `wails://localhost` on Linux and macOS, and `http://wails.localhost` on Windows — [assetserver_linux.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver_linux.go), [assetserver_darwin.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver_darwin.go), [assetserver_windows.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver_windows.go).
- Platform plumbing: Linux registers the scheme with `webkit_web_context_register_uri_scheme` ([linux_cgo.go L1291](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/linux_cgo.go#L1291)), macOS uses `setURLSchemeHandler:… forURLScheme:@"wails"` ([webview_window_darwin.go L181](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/webview_window_darwin.go#L181)), and Windows intercepts `http://wails.localhost/*` requests ([request_cancellation_windows.go L91-92](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/request_cancellation_windows.go#L91-L92)).
- **WebSocket upgrades are refused**: `if isWebSocket(req) { // WebSockets are not supported by the AssetServer; rw.WriteHeader(http.StatusNotImplemented) }` — [assetserver.go L84-88](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver.go#L84-L88).
- **Windows cannot stream responses**: the response writer "deliberately does not implement http.Flusher… Write accumulates into an in-memory buffer that is only handed to WebView2 in Finish… This is also why a streaming response cannot work on Windows today". On Linux and macOS `Flush()` is a no-op because data is passed through as it is written — [responsewriter_windows.go L33-42](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/webview/responsewriter_windows.go#L33-L42), [responsewriter_darwin.go L116-122](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/webview/responsewriter_darwin.go#L116-L122).
- Bindings: services' exported methods become callable from JS. The bridge is described as "In-memory: No network overhead, no HTTP", and `wails3 generate bindings` produces TypeScript models by static analysis — [concepts/architecture.md](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/concepts/architecture.md), [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0). Note the conflict: the release notes say bound-method calls from child frames go over HTTP to `/wails/runtime` — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0).
- Wails' official replacement for a WebSocket is **Streams** (`app.HandleStream(name, func(c *application.StreamConn))`, with `Stream("feed")` in JS). The guide on migrating from a WebSocket says: "The payoff is deleting the listener: no bound TCP port, no origin check, no token". It lists the parts that break silently: `ev.data` is always an `ArrayBuffer`, there is "no URL" (query and token parameters must move to the first frame), and broadcast registries must be kept by hand. It also says: "Non-WebSocket endpoints move to asset server middleware… Mount the same handlers on the asset server" — [guides/streams-from-websockets.md L10-L100](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/streams-from-websockets.md), [guides/streams.md](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/streams.md).
- A window can load an arbitrary URL instead of the embedded assets: `WebviewWindowOptions.URL` is documented as "Load external URL instead of embedded assets", with development and hybrid apps as use cases — [webview_window_options.go L96-97](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/webview_window_options.go#L96-L97), [features/windows/options.md L455-470](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/features/windows/options.md).
- `Assets.Handler` may be nil: `NewAssetServer` falls back to `http.NotFoundHandler()`, and Wails always installs its own runtime middleware — [assetserver.go L35-43](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver.go#L35-L43), [application.go L160-179](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/application.go#L160-L179).
- A pluggable `Transport` can replace the default HTTP-fetch IPC with, for example, a WebSocket. The example listens on `127.0.0.1:9099`, and the guide warns that "the sample origin policy is permissive and is not a production security policy" — [guides/custom-transport.md L8-62](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/custom-transport.md).

**Native features**
- Multiple windows, system tray (light and dark icons, a window attached to the tray), application, context and tray menus updatable at runtime, native message, question, open and save dialogs, notifications, window, app and global key bindings, clipboard, start at login, and per-window permissions — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0).
- Single instance: `Options.SingleInstance *SingleInstanceOptions{UniqueID, OnSecondInstanceLaunch, AdditionalData, EncryptionKey}`. Without the optional AES-256-GCM `EncryptionKey`, "data passed between instances is not secure… treat any data passed… as untrusted" — [guides/single-instance.md L18-50](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/single-instance.md), [application_options.go L111-112](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/application_options.go#L111-L112). Linux implements it over D-Bus (`godbus/dbus/v5`) and macOS with `flock` — [single_instance_linux.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/single_instance_linux.go), [single_instance_darwin.go L95](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/single_instance_darwin.go#L95).
- Auto-update: `app.Updater` takes pluggable providers (GitHub Releases, keygen.sh, Sparkle AppCast, the Wails Update Manifest, or your own). It "authenticates downloads against a configured public key" and swaps the binary atomically with rollback. The GitHub provider can verify against a `sha256sum`-format checksum asset, and inside an AppImage it replaces the file named by `$APPIMAGE` — [guides/updater.md L8-121](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/updater.md). An updater bug that stranded Linux users across filesystems (EXDEV) was fixed in September 2026 — [issue #6134](https://github.com/wailsapp/wails/issues/6134).

**Packaging and build tooling**
- The build is Taskfile-based. The Linux tasks are `linux:create:appimage`, `linux:create:deb`, `linux:create:rpm` and **`linux:create:aur`**, and deb and rpm are configured via `build/linux/nfpm/nfpm.yaml` — [guides/build/linux.md L18-50](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/linux.md).
- The AppImage "bundles WebKit and its helper processes" and keeps WebKit's bubblewrap sandbox on. On Arch, Fedora 39+ and Ubuntu 24.04+, `.relr.dyn` sections stop linuxdeploy's `strip`, so stripping is disabled and AppImages are about 20-40% larger — [guides/build/linux.md L65, L234-245](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/linux.md).
- macOS: `.app`, `wails3 task darwin:sign:notarize` (via `notarytool` and a keychain profile), and `darwin:package:dmg`. "DMG creation is supported only on macOS… the final DMG must be produced on a Mac" — [guides/build/macos.md L161-245](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/macos.md). The signing matrix marks macOS notarization as possible only from macOS — [guides/build/signing.md L20-26](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/signing.md).
- Windows: the default package is an **NSIS installer** that includes a WebView2 bootstrapper. **MSIX** is built via `wails3 package GOOS=windows FORMAT=msix`. Wails' installer guide only mentions MSI as an "alternative" with no template, so there is no first-class MSI — [guides/build/windows.md L8-35, L122-124](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/windows.md), [guides/installers.md L16-45](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/installers.md).

**One binary, two modes?**
- "Server mode is enabled via the `server` build tag" (`go build -tags server`). Its comparison table says "CGO required | Yes | No" (desktop vs server), and tray, dialogs and the app menu are "Not available" in server mode. Browser tabs become windows named `browser-N` and events travel over Wails' own WebSocket. `ServerOptions` has `WebSocketOriginPatterns` and `WebSocketAllowAllOrigins` ("Unsafe") — [guides/server-build.md L20-206](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/server-build.md), [application_options.go L163-187](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/application_options.go#L163-L187).

### Inferences
- nats-ui's REST API (`/api/*`) can be served through the Wails asset server unchanged, because it is just an `http.Handler`. `/ws` cannot be, and neither can the session cookie or `/launch` redirect flow. Two desktop shapes therefore exist:
  - **(A) Shell over loopback**: run nats-ui's existing loopback server and point the Wails window's `URL` at it.
  - **(B) Fully in-process**: mount the API on the asset server and re-plumb live data onto Wails Streams.
  (A) reuses everything as it is. (B) removes the TCP port but forks the transport layer.
- Wails' `-tags server` mode is irrelevant to nats-ui, because nats-ui already has its own plain `net/http` server. The "two modes" question is really whether the desktop-built binary can also run `nats-ui serve`. It can at the Go level if `serve` never calls `application.New`. On Linux and macOS, though, the binary is dynamically linked against GTK and WebKit, so it would not start on a headless host that lacks them (see Q6).
- v3.0.0 is five days old and ships weekly minors. Pin an exact version, and expect hotfixes in the first weeks.

### Gaps
- I could not confirm whether `WebviewWindowOptions.URL` pointing at `http://127.0.0.1:port` gets the Wails JS runtime (`/wails/runtime`) injected, which matters only if JS needs to call Wails APIs directly. The release notes and `AllowSimpleEventEmit` comments imply the runtime is origin-bound to the asset server.
- No measured latency or throughput comparison between Wails Streams and a loopback WebSocket was found.

## Q2. Wails v2 vs v3: migration, maturity, real apps

### Takeaway
v2 is in maintenance: v2.17.0 shipped on 2026-10-18 with security hardening, and "critical updates" continue. v3 is a real port, not an upgrade. The best-known Wails apps, including **NUI, the closest NATS GUI**, are still on v2, so v3's production track record is days old. NUI also shows the anti-pattern to avoid: its desktop build binds an unauthenticated API on all interfaces with CORS `*`.

### Cited Findings
- "Wails v2 isn't going away. It continues to receive critical updates", its docs moved to v2.wails.io, and the `wails` and `wails3` CLIs install side by side. Porting means changing the lifecycle, moving from context-bound bindings to services, replacing the v2 runtime package with app and window APIs, and regenerating bindings — [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0), [migration/v2-to-v3.md](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/migration/v2-to-v3.md).
- v2.17.0 (2026-10-18) hardened the `wails dev` IPC WebSocket. Before, "a malicious page in the developer's browser could connect to `ws://localhost:34115/wails/ipc` and invoke the entire bound Go API". The fix adds a Host allow-list, a same-origin Origin check, and a per-launch HttpOnly `SameSite=Strict` cookie named per port. The notes add that "other processes running as the developer's own user are outside the dev server's threat model" — [v2.17.0 release](https://github.com/wailsapp/wails/releases/tag/v2.17.0).
- The Wails repo has 36,862 stars and its last push was 2026-10-31 — GitHub API, [wailsapp/wails](https://github.com/wailsapp/wails).
- Real Wails apps include Tiny RDM (Redis GUI, about 13.1k stars, `wailsapp/wails/v2 v2.13.0`, [go.mod](https://github.com/tiny-craft/tiny-rdm/blob/main/go.mod)), Wombat (gRPC client, last push 2024-07, [repo](https://github.com/rogchap/wombat)) and about 40 others in the docs showcase, including MQStudio and Redis Viewer — [community/showcase](https://github.com/wailsapp/wails/tree/v3.0.0/docs/mpress/content/community/showcase).
- **NUI** (`nats-nui/nui`, 687 stars, v0.10.0 on 2026-10-21) uses `github.com/wailsapp/wails/v2 v2.12.0` and builds with `wails build -tags webkit2_41`. It ships "both from Desktop App or Web interface" from one repo, with `main.go` for desktop and `cmd/server/main.go` for web — [go.mod](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/go.mod), [Makefile L11-15](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/Makefile), [README](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/README.md).
- In desktop mode, NUI's frontend calls `http://localhost:31311/api/` ([AjaxService/index.ts L38](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/frontend/src/plugins/AjaxService/index.ts#L38)). The Fiber server does `a.Listen(":" + a.Port)` with port `31311`, which binds all interfaces ([server.go L139](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/internal/nui/server.go#L139), [app.go L34](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/internal/app/app.go#L34)). It also sets CORS `AllowOrigins = "*"` when desktop, with the comment: "wails in linux / mac desktop app is using wails://wails, http://wails.localhost… so * wildcard is required" — [server.go L42-52](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/internal/nui/server.go#L42-L52).
- NUI v0.10.0 release asset sizes: `linux-amd64-nui-app` 75 MiB, `windows-amd64-nui-app.exe` 78 MiB, the NSIS installer 23 MiB, and the macOS `.app.zip` and `.pkg` 40 MiB each — GitHub API, [NUI v0.10.0](https://github.com/nats-nui/nui/releases/tag/v0.10.0).

### Inferences
- NUI shows that Go, Wails and React with a localhost HTTP API is a workable shape for a NATS GUI. It also shows what goes wrong when the desktop path drops the server's protections. nats-ui's Launch token, Host check and Origin check would prevent exactly that.
- Starting a new app on v2 in late 2026 would mean an unavoidable port later. Starting on v3 trades that for early-stable risk.

### Gaps
- I found no well-known production app that has already shipped on v3.0.0 stable. Showcase entries do not state their Wails major version.

## Q3. webview/webview, webview_go and other thin bindings

### Takeaway
`webview/webview_go` is effectively unmaintained: its last commit was 2024-08-31, and it hard-codes `webkit2gtk-4.0`, a package Arch's repos no longer carry. The upstream C library `webview/webview` is active and supports WebKitGTK 6.0 and 4.1, but its last tag is 0.12.0 (2024-09). A thin binding gives a window and JS bindings only: no tray, menus, dialogs, single instance, updater or packaging.

### Cited Findings
- `webview_go` cgo directives: `#cgo linux … pkg-config: gtk+-3.0 webkit2gtk-4.0`, `#cgo darwin LDFLAGS: -framework WebKit`, and `#cgo windows … -DWEBVIEW_EDGE … mswebview2/include`, so all three platforms need cgo — [webview.go L4-15](https://github.com/webview/webview_go/blob/6173450d4d/webview.go#L4-L15).
- Its last commits are "Expand CI job matrix" (2024-08-31) and "Update core webview library to version fb6b17d" (2024-02-20). It has 458 stars and 38 open issues — GitHub API, [webview_go commits](https://github.com/webview/webview_go/commits/master).
- The upstream `webview/webview` README lists three Linux stacks: "WebKitGTK 6.0, GTK 4", "WebKitGTK 4.1, GTK 3, libsoup 3" and "WebKitGTK 4.0, GTK 3, libsoup 2". Windows uses WebView2 — [webview README](https://github.com/webview/webview/blob/master/README.md). Its latest tag is `0.12.0` (commit dated 2024-09-11), it has no GitHub Releases, and its last push was 2026-10-22 — GitHub API, [webview tags](https://github.com/webview/webview/tags).
- Arch `extra` provides `webkitgtk-6.0` and `webkit2gtk-4.1` (both 2.54.1) — [Arch package webkitgtk-6.0](https://archlinux.org/packages/extra/x86_64/webkitgtk-6.0/), [Arch package webkit2gtk-4.1](https://archlinux.org/packages/extra/x86_64/webkit2gtk-4.1/). On this machine, `pacman -Si webkit2gtk` (4.0) found no package (local observation).
- Wails v3 defaults to GTK4 and WebKitGTK 6.0, keeps `-tags gtk3` (WebKit2GTK 4.1) "until v3.1", and says "Distributions with only WebKit2GTK 4.0 are not supported" — [faq.md L20](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/faq.md), [guides/build/linux.md L109-133](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/linux.md).
- On Windows, Wails builds without cgo: "Windows is the simplest cross-compilation target because it doesn't require CGO by default" — [guides/build/cross-platform.md L40-46](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/cross-platform.md). NUI's go.mod pulls in `github.com/wailsapp/go-webview2 v1.0.22` — [go.mod](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/go.mod).

### Inferences
- On Omarchy, stock `webview_go` would not build without forking it to change the pkg-config line to `webkit2gtk-4.1` or `webkitgtk-6.0`. Using it means owning a fork of a dormant binding.
- A thin webview pointed at nats-ui's loopback URL would be about 30 lines of Go. Tray, menus, dialogs, single instance, signing and installers would then all have to be built by hand. Wails v3 gives those for the same cgo cost.

### Gaps
- I did not evaluate newer forks of webview_go, or other Go bindings such as a maintained go-webview2 used standalone, for maintenance status.

## Q4. Platform webview quirks: Wayland/Hyprland, WebSocket and cookies on custom schemes, keyboard shortcuts, clipboard

### Takeaway
The biggest risk for this user is **NVIDIA plus WebKitGTK DMA-BUF**: blank windows and "Error 71" crashes. Wails v3 sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` automatically when NVIDIA renders. Cookies do not work on Wails' custom scheme (an upstream WebView limitation), and the asset server cannot carry WebSockets. Both work normally if the window loads `http://127.0.0.1:port`. On Windows, Wails disables WebView2's browser accelerator keys, so Ctrl-shortcuts reach the page.

### Cited Findings
**Wayland, Hyprland and GPU**
- Wails Linux guide: "On Linux with NVIDIA proprietary drivers, Wails apps may show a blank or white window… WebKitGTK bug where the DMA-BUF renderer fails with `gbm_bo_map()`… (affects X11 and Wayland, driver versions 377–580+…)". It also says "**Wails applies `WEBKIT_DISABLE_DMABUF_RENDERER=1` automatically** when it detects the NVIDIA kernel module", and links upstream [WebKit #262607](https://bugs.webkit.org/show_bug.cgi?id=262607) and [WebKit #180739](https://bugs.webkit.org/show_bug.cgi?id=180739) — [guides/build/linux.md L212-224](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/linux.md).
- In code, `application_linux.go` sets the variable only if it is unset and `isNVIDIAGPU()` is true, "on any session type, to prevent blank windows and 'Error 71 (Protocol error)' crashes". `gpu_linux.go` notes that "a loaded nvidia module alone is not enough", so PRIME laptops are handled — [application_linux.go L30-36](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/application_linux.go#L30-L36), [gpu_linux.go L11-16](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/gpu_linux.go#L11-L16).
- Tauri's WebKitGTK guidance lists fixes in order: `nvidia_drm.modeset=1` (drivers older than 545), then `__NV_DISABLE_EXPLICIT_SYNC=1` ("often fixes the Wayland `Error 71` crash without a performance cost"), then `WEBKIT_DISABLE_DMABUF_RENDERER=1` (at the cost of the faster path), then `WEBKIT_DISABLE_COMPOSITING_MODE=1` as a last resort. It warns: "Only ship an unconditional override like this if you have verified your app is affected" — [Tauri: Linux graphics issues](https://v2.tauri.app/develop/debug/linux-graphics/).
- Hyprland: a Tauri/WebKitGTK app (Cinny) crashed on launch on NVIDIA after Hyprland's syncobj refactor. A maintainer called it a client failure that "hits same thing on gnome" — [Hyprland #9690](https://github.com/hyprwm/Hyprland/issues/9690). A GTK4 WebKit app (Foliate) showed a blank page at scale >1 on NVIDIA on Hyprland 0.41-0.42 but not on Sway; the issue is closed — [Hyprland #7341](https://github.com/hyprwm/Hyprland/issues/7341).
- Open Wails v3 Linux issues as of 2026-10-31:
  - On Hyprland, the cursor warps to an attached systray window on a second click — [#5839](https://github.com/wailsapp/wails/issues/5839).
  - Closing a WebviewWindow leaves its WebKitWebProcess running ("~50 MB leaked per window", GTK4) — [#6505](https://github.com/wailsapp/wails/issues/6505).
  - Resizing a GTK4 frameless window jumps — [#6257](https://github.com/wailsapp/wails/issues/6257).
  - Tray `openMenu()` is not implemented on Linux — [#6327](https://github.com/wailsapp/wails/issues/6327).
  - Opening the tray context menu hides the app — [#4494](https://github.com/wailsapp/wails/issues/4494).
- GTK4 file dialogs go through `xdg-desktop-portal`, so default-directory and filter options "behave differently from GTK3" — [guides/build/linux.md L151](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/linux.md).

**WebSocket and cookies on custom schemes vs http://localhost**
- The asset server returns 501 for WebSocket upgrades — [assetserver.go L84-88](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver.go#L84-L88).
- Wails maintainers say cookie support "will require support for cookies over custom protocols in the upstream projects". The issue is still open (filed 2024-11), and one comment says "the cookies are an issue of the WebViews… Version 3 doesn't change anything" — [Wails #3908](https://github.com/wailsapp/wails/issues/3908). An earlier macOS report has `document.cookie` working in `wails dev` (http dev server) but failing in a built app — [Wails #2590](https://github.com/wailsapp/wails/issues/2590). A v3 cookie-access API is requested but not built — [Wails #5799](https://github.com/wailsapp/wails/issues/5799).
- Microsoft says it is "preferable" to manage cookies with the cookie-management APIs rather than through WebResourceRequested interception. It also notes the network stack may add cookie headers after the event fires — [WebView2: custom management of network requests](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webresourcerequested).
- WebKitGTK's `register_uri_scheme_as_secure` only means "mixed content warnings are not generated for this scheme when included by an HTTPS page" — [WebKitGTK SecurityManager docs](https://webkitgtk.org/reference/webkit2gtk/stable/method.SecurityManager.register_uri_scheme_as_secure.html). Wails' Linux code calls `webkit_web_context_register_uri_scheme` and, in the v3.0.0 Linux sources I searched, never `…_as_secure` — [linux_cgo.go L1291](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/linux_cgo.go#L1291).
- NUI's desktop build works around the custom origin by calling a separate `http://localhost:31311` server with CORS `*` — [server.go L42-52](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/internal/nui/server.go#L42-L52).

**Keyboard shortcuts**
- Wails' Windows backend calls `settings.PutAreBrowserAcceleratorKeysEnabled(false)` unconditionally, along with turning off the status bar and swipe navigation — [webview_window_windows.go L2742](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/webview_window_windows.go#L2742).
- Wails offers app-level bindings (`app.KeyBinding.Add("Ctrl+S", …)`, with `Cmd+…` variants for macOS) and global shortcuts. On macOS, letter accelerators follow the labelled key on AZERTY, QWERTZ and Dvorak — [features/keyboard/shortcuts.md](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/features/keyboard/shortcuts.md), [v3.0.0 release](https://github.com/wailsapp/wails/releases/tag/v3.0.0). Linux global shortcuts have both an xdg-portal and an X11 backend — [global_shortcut_linux_portal.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/global_shortcut_linux_portal.go).

**Clipboard**
- Wails exposes `app.Clipboard.SetText` and `app.Clipboard.Text()` from Go, plus a runtime message processor for JS — [features/clipboard/basics.md](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/features/clipboard/basics.md), [messageprocessor_clipboard.go](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/messageprocessor_clipboard.go). The GTK3 build uses `gtk_clipboard_get(GDK_SELECTION_CLIPBOARD)` — [linux_cgo_gtk3.go L749-751](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/linux_cgo_gtk3.go#L749-L751).

### Inferences
- For this user (RTX 2080 on Hyprland), Wails' NVIDIA auto-detection is a real advantage over a hand-rolled `webview_go` window. A thin binding would have to replicate it, at minimum by setting `WEBKIT_DISABLE_DMABUF_RENDERER=1` before GTK initialises. If crashes persist, try `__NV_DISABLE_EXPLICIT_SYNC=1` next.
- Loading the window from `http://127.0.0.1:<port>` keeps nats-ui's cookie, `/launch` redirect and `coder/websocket` behaviour identical to browser mode. The page is then an ordinary http origin, and WebKit, WKWebView and WebView2 all handle cookies and WebSockets there as a browser would.
- With the in-process `wails://` asset server, `navigator.clipboard` may not be available if WebKit does not treat `wails://` as a secure context (unverified). Wails' Go clipboard API sidesteps the question. On an `http://127.0.0.1` origin, loopback counts as potentially trustworthy in browsers, so `navigator.clipboard` should behave as it does in browser mode (inferred from browser behaviour; not verified per webview).
- Cmd/Ctrl+K: in desktop mode no browser chrome competes for the shortcut. Windows' browser accelerators are off, and WKWebView and WebKitGTK have no address bar. A Wails application-menu accelerator bound to the same key would probably intercept it before the page sees it, so pick one owner (inferred; not verified per platform).

### Gaps
- I found no primary source stating whether a page on `wails://localhost` (WebKitGTK or WKWebView) can open `ws://127.0.0.1:…` without mixed-content or CORS-like blocking. The inference that it can rests on custom schemes not being "secure", and it was not tested.
- I found no source listing WebKitGTK or WKWebView built-in shortcuts that would capture Ctrl/Cmd+K, nor any source on which browsers reserve Ctrl+K in browser mode.
- I found no Hyprland-specific Wails v3 rendering report on AMD or Intel GPUs. All the blank-window reports I found involve NVIDIA.

## Q5. Security model in desktop mode

### Takeaway
If the UI loads from Wails' in-process asset server and live data uses Streams, **no TCP port exists**. The Launch token, Host check, Origin check and session cookie then become unnecessary for that path, and cookies would not work there anyway. If instead the window loads nats-ui's existing loopback server, **every existing protection must stay**. Other local processes can reach that port, and Wails' own docs and v2 advisory show what happens when one is left open (and NUI ships exactly that). The cleanest desktop auth is to hand the Launch token to the in-process webview directly via the initial URL. It is never printed and never placed on another process's argv.

### Cited Findings
- Wails' own guidance on WebSocket servers: "A port bound on localhost is reachable by every process on the machine, so a careful implementation adds a token or a nonce to stop other software connecting. There is no port to reach any more" (once migrated to Streams) — [guides/streams-from-websockets.md L30](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/streams-from-websockets.md).
- Wails v2's `wails dev` IPC WebSocket accepted any origin until 2026-10. The fix is a Host allow-list, a same-origin Origin check and an HttpOnly `SameSite=Strict` per-port capability cookie, which is the same shape as nats-ui's ADR-0001 model. "Other processes running as the developer's own user are outside the dev server's threat model" — [v2.17.0 release](https://github.com/wailsapp/wails/releases/tag/v2.17.0).
- Wails' server mode adds a Host guard for loopback binds ("Server request rejected: Host %q is not allowed for a loopback bind") and Origin checks on its WebSocket and `/wails/runtime` — [host_guard_server.go L35-92](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/host_guard_server.go#L35-L92), [transport_http_server.go L16-35](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/transport_http_server.go#L16-L35).
- In-webview risk that remains: iframes. Same-origin child frames on Linux can reach the native handler, and on every platform child-frame bound-method calls go over `/wails/runtime` unguarded — [v3.0.0 release, Known limitations](https://github.com/wailsapp/wails/releases/tag/v3.0.0). `AllowSimpleEventEmit` lets "ANY script running in the page — including content from a remote URL or any XSS sink" trigger named Go event handlers, and is off by default — [webview_window_options.go L135-154](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/webview_window_options.go#L135-L154).
- Single-instance messages are unauthenticated unless `EncryptionKey` is set — [guides/single-instance.md L35-50](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/single-instance.md).
- Counter-example: NUI's desktop app listens on `:31311` on all interfaces, with CORS `*` and no token — [server.go L42-52, L139](https://github.com/nats-nui/nui/blob/71d1487c47cc99f3fc379ddb8236cb3463e21d0a/internal/nui/server.go).
- nats-ui's current model (from the project's own report): a strict Host allow-list stops DNS rebinding, `http.CrossOriginProtection` and an Origin check on the WS upgrade stop CSRF, and the session cookie covers clients that send no headers. A token passed to the browser opener is briefly visible in argv — [reports/Go backend building blocks.md](../../reports/Go%20backend%20building%20blocks.md) (internal), citing [Jupyter serverapp.py](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/serverapp.py).

### Inferences
- **Shape A, a Wails window on `http://127.0.0.1:0`**, keeps ADR-0001's checks verbatim. The only change is how the token travels. The desktop main generates the token, starts the listener, and sets `WebviewWindowOptions.URL` to `http://127.0.0.1:<port>/launch?token=<t>`. The token never goes to stdout or argv, and the webview's cookie jar holds the session. The `natsui_session_<port>` cookie name and the Host allow-list still apply, and the expected Origin is `http://127.0.0.1:<port>`. Browser mode is unchanged. Optionally, desktop mode could print no token at all and refuse `/launch` after its first use. The single-use problem the report raised does not arise, because the webview is the only intended client.
- **Shape B, fully in-process (`wails://` or `http://wails.localhost` plus Streams)**, has no listener, so there is nothing for other processes or websites to reach. Origin and Host checks are moot, and cookies fail anyway. The domain API's Read-only enforcement still lives server-side in Go, so ADR-0001's rule that "credentials never reach the browser" holds, since the webview is just another client of the same handlers. The middleware stack then has to branch per transport (skip session and Host checks for asset-server requests), and Wails' iframe caveats become nats-ui's problem. Never render NATS payloads in iframes; ADR-0003's message viewer should keep rendering payloads as text.
- Same-user local processes can read the process's memory or the webview's cookie store, so neither shape defends against them, consistent with Wails v2's stated threat model. The token defends against other users on shared machines and against browser-borne attacks.

### Gaps
- I found no Wails documentation describing a recommended auth pattern for apps that keep their own loopback HTTP server alongside a Wails window, beyond "migrate to Streams".

## Q6. Cost: cgo, cross-compilation, release pipeline, binary size

### Takeaway
Desktop builds need **cgo on Linux and macOS but not on Windows**. GoReleaser's `CGO_ENABLED=0` matrix therefore stays valid for the headless binary and the Windows desktop build. Linux and macOS desktop artifacts need native runners (simplest), Wails' Docker images (about 800 MB), goreleaser-cross, or GoReleaser Pro split/merge. DMG creation and, per Wails, notarization need a Mac. Expect desktop binaries in the tens of MB. Wails claims about 10-15 MB for simple apps, and NUI, a comparable NATS GUI on Wails v2, ships 75-78 MB binaries.

### Cited Findings
- "Windows is the simplest cross-compilation target because it doesn't require CGO by default." "macOS builds require CGO for WebView integration". "Linux builds require CGO for WebView integration". From other hosts, Wails falls back to Docker images set up once with `wails3 task setup:docker` ("~800MB download"). "Cross-compiled macOS binaries are not code-signed" — [guides/build/cross-platform.md L10-122](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/cross-platform.md).
- GoReleaser: CGO "requires extra setup and won't work 'out of the box'". Split and merge (Pro) is "the recommended approach as it's the simplest and most reliable". The alternatives are `goreleaser-cross` Docker images or Zig as the C compiler ("might not work for all cases"), and `xgo` is "not natively supported" — [GoReleaser CGO limitations](https://goreleaser.com/limitations/cgo/).
- Wails' signing matrix allows macOS notarization only from macOS — [guides/build/signing.md L20-26](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/signing.md). In contrast, GoReleaser's built-in quill notarizes from Linux — [GoReleaser notarize](https://goreleaser.com/customization/notarize/). DMGs must be built on a Mac — [guides/build/macos.md L245](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/macos.md).
- Wails' own size claims: "a single binary that typically weighs in around 10MB" ([faq.md L12](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/faq.md)), "~15MB binaries" ([quick-start/why-wails.md](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/quick-start/why-wails.md)), and "Typically 5-10MB" or "10-20MB for simple apps" by platform ([concepts/architecture.md L528-539](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/concepts/architecture.md)).
- Real-world sizes for NUI v0.10.0 (Wails v2): Linux binary 75 MiB, Windows exe 78 MiB, NSIS installer 23 MiB, macOS zip 40 MiB — [NUI v0.10.0 assets](https://github.com/nats-nui/nui/releases/tag/v0.10.0).
- Linux runtime dependency: a default build needs `gtk4` and `webkitgtk-6.0` on Arch, and "installing the legacy libraries does not satisfy a default build" — [guides/build/linux.md L168-190](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/guides/build/linux.md). Arch's `webkitgtk-6.0` is about 139 MiB installed and `gtk4` about 54 MiB (local `pacman -Si`; see [Arch package webkitgtk-6.0](https://archlinux.org/packages/extra/x86_64/webkitgtk-6.0/)).
- nats-ui's current release plan is GoReleaser v2 OSS with `CGO_ENABLED=0` across linux, darwin and windows on amd64 and arm64, and a `go install` channel that needs committed `web/dist` — [reports/Go backend building blocks.md](../../reports/Go%20backend%20building%20blocks.md) (internal).

### Inferences
- A cgo build on Linux links `libwebkitgtk-6.0` and `libgtk-4` dynamically, so the desktop binary will not even exec on a headless server without them, whatever subcommand is used. It also breaks `go install` for anyone without GTK and WebKit dev headers. **Keep the default build `CGO_ENABLED=0` and headless, and put the desktop entry point behind a `desktop` build tag.** That gives two artifacts per OS on Linux and macOS, from one codebase and one `main` package. On Windows the desktop build needs no cgo, so a single Windows binary could serve both modes. It is unverified whether its size and the WebView2 dependency at window creation are acceptable for headless use.
- Pipeline sketch: keep the existing GoReleaser OSS job for the headless binaries. Add a CI matrix of native runners (ubuntu with webkitgtk-6.0 or an Arch container, plus macos-latest) that runs `wails3 task package` or plain `go build -tags desktop`, and attach the outputs to the same GitHub Release. On Arch, prefer the AUR or native package (`linux:create:aur`) over the AppImage, which bundles its own WebKit.
- The Wails module adds dependencies (godbus, mimetype and more) only to the `desktop`-tagged build. The headless binary's dependency graph and SBOM stay as they are, provided Wails is imported only from `//go:build desktop` files.

### Gaps
- I found no measured size for a minimal Wails v3.0.0 binary, or for the size Wails adds on top of nats-ui's current binary. Measure by building both.
- I did not verify whether Zig-based cgo cross-compilation of WebKitGTK 6.0 and GTK4 apps works with GoReleaser.

## Q7. Recommendation and code sketches

### Takeaway
**Recommended: Wails v3, pinned exactly (v3.0.0 or the latest hotfix), in "shell over loopback" mode (shape A), behind a `desktop` build tag.** The window loads nats-ui's existing `127.0.0.1:0` server via an in-process `/launch?token=` URL, so the domain API, `coder/websocket` live data, cookies and Host/Origin checks are reused unchanged. Wails adds tray, menus, native dialogs, single instance, the updater and installers. Consider shape B (in-process asset server plus Streams) only later, if removing the port is worth forking the live-data transport and the auth middleware. Avoid `webview_go`.

### Cited Findings
- The components the recommendation relies on: `WebviewWindowOptions.URL` ([options.md L455-470](https://github.com/wailsapp/wails/blob/v3.0.0/docs/mpress/content/features/windows/options.md)), a nil `Assets.Handler` falling back to NotFound ([assetserver.go L40-43](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver.go#L40-L43)), `SingleInstanceOptions` ([single_instance.go L28-35](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/single_instance.go#L28-L35)), and `app.Window.NewWithOptions` ([updater_host.go L67](https://github.com/wailsapp/wails/blob/v3.0.0/v3/pkg/application/updater_host.go#L67)).
- The facts behind ruling out shape B as the default: WebSocket returns 501 ([assetserver.go L84](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/assetserver.go#L84)), cookies fail on custom schemes ([#3908](https://github.com/wailsapp/wails/issues/3908)), and Windows cannot stream asset-server responses ([responsewriter_windows.go L33-42](https://github.com/wailsapp/wails/blob/v3.0.0/v3/internal/assetserver/webview/responsewriter_windows.go#L33-L42)).

### Inferences
Comparison:

| | Wails v3, shape A (loopback) | Wails v3, shape B (in-process) | webview_go window | Browser mode (today) |
|---|---|---|---|---|
| Reuse of handlers, `/ws`, cookies | All as-is | REST as-is; `/ws` → Streams; cookie and Host middleware bypassed | All as-is | All |
| TCP port exposed | Yes, protected by token, Host and Origin | None | Yes, same as A | Yes |
| Tray, menus, dialogs, single instance, updater | Yes (Go-side) | Yes (Go and JS) | No | No |
| cgo | Linux and macOS | Linux and macOS | All three | None |
| Linux WebKit | 6.0 (4.1 via `-tags gtk3` until v3.1) | Same | 4.0 hard-coded (fork needed) | n/a |
| NVIDIA DMA-BUF workaround | Automatic | Automatic | Manual | n/a |
| Maturity | Stable 5 days, weekly minors | Same, plus Streams API | Dormant since 2024-08 | Proven |

Sketch: desktop entry point (shape A). The file is `cmd/nats-ui/desktop.go`, compiled only with `-tags desktop`.

```go
//go:build desktop

package main

import (
	"fmt"
	"net"
	"net/http"
	"net/url"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func init() { desktopMain = runDesktop } // main() calls desktopMain if non-nil and no "serve" subcommand

func runDesktop(cfg Config) error {
	srv := newServer(cfg) // same constructor browser mode uses: Host allow-list, CrossOriginProtection, session, Read-only
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	srv.SetAllowedHostPort(ln.Addr().String()) // Host + Origin = http://127.0.0.1:<port>
	go http.Serve(ln, srv.Handler())

	launch := fmt.Sprintf("http://%s/launch?token=%s", ln.Addr(), url.QueryEscape(srv.LaunchToken()))

	var win *application.WebviewWindow
	app := application.New(application.Options{
		Name: "NATS UI",
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "io.github.natsui.desktop",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				win.Show(); win.Focus() // never act on passed args unless EncryptionKey is set
			},
		},
		// No Assets.Handler: the window never loads wails://; the asset server falls back to NotFound.
	})
	win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "NATS UI",
		URL:   launch, // token stays in-process: not printed, not on any argv
	})
	// Tray, menus, dialogs: driven from Go. If the UI needs a native "Open file…",
	// expose it as a desktop-only domain endpoint (POST /api/desktop/open-dialog)
	// registered only in this file, which calls app.Dialog and returns the path.
	return app.Run()
}
```

Sketch: the default headless entry point stays cgo-free. In `main.go`, with no build tag:

```go
var desktopMain func(Config) error // set only in desktop builds

func main() {
	cfg := parseFlags()
	if desktopMain != nil && !cfg.Serve { // `nats-ui serve` forces browser mode even in desktop builds
		if err := desktopMain(cfg); err != nil { log.Fatal(err) }
		return
	}
	runBrowserServer(cfg) // existing path: print Launch token, open browser via cli/browser
}
```

Sketch: shape B, for later. It mounts the same handler in-process and moves live data to Streams.

```go
app := application.New(application.Options{
	Assets: application.AssetOptions{Handler: srv.InProcessHandler()}, // API + SPA, no Host/session middleware
})
app.HandleStream("live", func(c *application.StreamConn) { // replaces /ws; first frame carries subscribe params
	srv.ServeLive(c.Context(), streamAdapter{c})           // adapter so the live mux is transport-agnostic
})
```

Release pipeline: GoReleaser OSS keeps `CGO_ENABLED=0` for the headless artifacts, and also builds the Windows desktop artifact (no cgo). A separate CI matrix (Arch container with `webkitgtk-6.0`, plus macOS) runs `go build -tags desktop` or the `wails3 task` packaging for AUR, deb, rpm, `.app`/DMG and notarization, and uploads to the same release. `go install` keeps installing the headless build.

On Omarchy, the AUR package depends on `gtk4` and `webkitgtk-6.0`. Wails handles the NVIDIA DMA-BUF workaround. Document `__NV_DISABLE_EXPLICIT_SYNC=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` as fallbacks for blank windows or crashes.

This recommendation implies ADR changes. ADR-0001's "single binary is the only way the app is distributed" needs amending to "one codebase, a headless binary plus optional desktop builds", and the glossary's Launch token entry should note that in desktop mode the token is passed to the webview in-process.

### Gaps
- Not verified by building: that a Wails v3 window loaded from `http://127.0.0.1:<port>` on WebKitGTK 6.0, WKWebView and WebView2 accepts the 303 redirect, the `SameSite=Strict` cookie and the `coder/websocket` upgrade with no Wails-specific interference. Each step is standard http-origin behaviour, but a short spike on all three platforms is needed.
- Not verified: whether a Windows desktop binary started with `serve` avoids loading WebView2 entirely, so it could serve as the single Windows artifact.
