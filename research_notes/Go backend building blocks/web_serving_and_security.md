# Web serving and localhost security for the nats-ui Go binary

Scope: how one Go binary serves the embedded React/Vite SPA, the domain API and the live-data WebSocket, and how it protects a localhost-only, no-login UI. That UI uses a launch token, a session cookie, and Host and Origin checks (see `docs/adr/0001-go-backend-with-domain-api.md` and the GLOSSARY entry "Launch token"). Research date: 2026-10-31. GitHub status figures come from the GitHub REST API (`gh api repos/<owner>/<repo>`), queried on 2026-10-31.

## 1. Embedding the frontend (embed.FS, SPA fallback, caching, go install, Vite dev proxy)

### Takeaway
Use `//go:embed all:dist` and `fs.Sub` to serve the Vite build. Put a small handler in front that serves real files, gives hashed `/assets/*` files an immutable cache header, and falls back to `index.html` with `no-cache` for any other non-API path. `go build`, `go install` and `go generate` never run npm, so a working `go install module@version` needs the built `dist/` in the module. Either commit it (or have the release process commit it) or embed a committed placeholder and document that `go install` gives an API-only or stub UI. In development, run Vite on its own port and proxy `/api` and the WebSocket path to Go. That breaks Origin/Host equality, so the Go server needs an explicit dev-mode trusted origin.

### Cited Findings
- `//go:embed` directory matches skip files whose names start with `.` or `_` unless the pattern uses the `all:` prefix. Patterns may not match files outside the package's module, and may not contain `.`, `..` or empty path elements — [pkg.go.dev/embed](https://pkg.go.dev/embed)
- "each pattern in a //go:embed line must match at least one file or non-empty directory". If any pattern is invalid or has invalid matches, "the build will fail". A missing or empty `dist/` is therefore a compile error, not an empty UI — [pkg.go.dev/embed](https://pkg.go.dev/embed)
- "Matches for empty directories are ignored" — [pkg.go.dev/embed](https://pkg.go.dev/embed)
- The documented way to serve an embed.FS is `mux.Handle("/", http.FileServer(http.FS(content)))` — [pkg.go.dev/embed](https://pkg.go.dev/embed)
- Go 1.22 added `http.FileServerFS`, `http.ServeFileFS` and `http.NewFileTransportFS`, which take an `fs.FS` directly. (From the Go 1.22 release notes. Not re-fetched this session.) — [go.dev/doc/go1.22](https://go.dev/doc/go1.22)
- `go generate` is never run automatically by `go build` (and so not by `go install`). It must be run explicitly. (Not re-fetched this session.) — [go.dev/blog/generate](https://go.dev/blog/generate)
- Go 1.25 added a `go.mod` `ignore` directive. It makes the go command skip directories (for example `web/node_modules`) when matching `all` or `./...`, but "their files are still included in module zip files". It keeps `./...` fast, but it does not shrink the module — [go.dev/doc/go1.25](https://go.dev/doc/go1.25)
- Go 1.26: ServeMux "trailing slash redirects now use HTTP status 307 (Temporary Redirect) instead of 301", so browsers no longer permanently cache those redirects — [go.dev/doc/go1.26](https://go.dev/doc/go1.26)
- Vite's `server.proxy` keys are path prefixes: "Any requests whose request path starts with that key will be proxied to the specified target". The documented WebSocket form is `{ target: 'ws://localhost:5174', ws: true, rewriteWsOrigin: true }`. The HTTP form shows `changeOrigin: true` and `rewrite` — [vite.dev/config/server-options](https://vite.dev/config/server-options)
- Vite's backend-integration guide describes the other mode, where the backend serves HTML and loads Vite's dev assets. Set `build.manifest: true`, which generates `.vite/manifest.json` in `outDir`. Include `<script type="module" src="http://localhost:5173/@vite/client">` plus the entry. Set `server.cors.origin` to the backend origin, and set `server.origin` or proxy asset requests — [vite.dev/guide/backend-integration](https://vite.dev/guide/backend-integration)
- Vite's dev-server CORS default is now `{ origin: /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/ }`. It is no longer `true` / `*` — [vite.dev/config/server-options](https://vite.dev/config/server-options)

### Code sketch (SPA handler)
```go
//go:embed all:dist
var distFS embed.FS

func spaHandler() http.Handler {
    sub, _ := fs.Sub(distFS, "dist")   // strip the "dist/" prefix
    files := http.FileServerFS(sub)    // Go 1.22+
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
        if p == "" { p = "index.html" }
        if st, err := fs.Stat(sub, p); err == nil && !st.IsDir() {
            if strings.HasPrefix(p, "assets/") {          // Vite hashed output
                w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
            } else {
                w.Header().Set("Cache-Control", "no-cache")
            }
            files.ServeHTTP(w, r)
            return
        }
        if strings.HasPrefix(p, "assets/") { http.NotFound(w, r); return } // don't mask missing chunks
        w.Header().Set("Cache-Control", "no-cache")
        http.ServeFileFS(w, r, sub, "index.html")        // client-side route fallback
    })
}
// mux.Handle("/api/", api); mux.Handle("GET /ws", ws); mux.Handle("GET /", spaHandler())
```

### Inferences
- Choosing how `go install` gets the assets:
  - (a) Commit `web/dist`, rebuilt in CI, with a CI check that it is fresh. `go install github.com/.../nats-ui@vX` then gets the full UI. The cost is churn in git and larger module zips.
  - (b) Commit only a placeholder `dist/index.html`, so the embed pattern still matches. Have release builds (for example GoReleaser `before.hooks: npm ci && npm run build`) overwrite it. The ADR lists `go install` as a supported channel, so (b) would mean `go install` users get a stub page. That makes (a) the option that matches the ADR, or (a) used only on release tags.
  - (c) A build tag (`//go:build embedui`) that switches between the real embed and a stub. This still needs the files present when the tag is set.
- `go generate` cannot help `go install` users, because it never runs during build or install (see the citations above).
- Don't use `ServeMux` on the SPA's `/` route alone for fallback. `http.FileServer` returns 404 for client-side routes such as `/streams/ORDERS`, so the stat-then-fallback wrapper above is needed. Return a real 404 for missing `/assets/*` files. Otherwise a stale tab requesting an old chunk gets HTML back, and module loading fails with a confusing MIME error.
- Dev workflow: Vite on 5173 proxies `/api` and `/ws` (with `ws: true`) to Go on, say, 8080. Browser requests then carry `Origin: http://localhost:5173`. With `changeOrigin: true` the Host becomes `localhost:8080`, so Origin≠Host and the Go Origin check (and `CrossOriginProtection`) would reject them. Fixes, in order of preference:
  1. A `--dev` flag that calls `AddTrustedOrigin("http://localhost:5173")` and adds that origin to the WebSocket `OriginPatterns`.
  2. `changeOrigin: false`, plus adding `localhost:5173` to the Go Host allow-list.
  3. `rewriteWsOrigin: true` for the WebSocket only.

  The launch-token cookie works through the proxy, because cookies are host-scoped rather than port-scoped (RFC 6265 §8.5, see section 4). Open the launch URL against 5173 in dev.
- Vite's `build.assetsDir` default is `assets`, and its output filenames are content-hashed. That is why the `assets/` prefix check above is safe for an immutable cache header. This comes from Vite's build options; it was not re-fetched this session (see Gaps).

### Gaps
- The Vite `build.assetsDir` default (`assets`) and the hashed file naming were not re-fetched this session ([vite.dev/config/build-options](https://vite.dev/config/build-options)).
- Not confirmed from docs this session: files in an `embed.FS` report a zero `ModTime`, so `http.FileServer` sends no `Last-Modified` and no `ETag`. The explicit `Cache-Control` headers above are the reason that doesn't matter.
- I did not survey which well-known Go projects commit their built SPA. There is no cited precedent for option (a) versus option (b).

## 2. Routing: stdlib ServeMux vs chi; current Go version and recent net/http changes

### Takeaway
The latest stable Go is **go1.27.3 (2026-10-19)**, and Go 1.27.0 was released 2026-08-19. Go 1.26 (latest point release 1.26.10) is the only other supported line. The standard `ServeMux` with method and wildcard patterns (Go 1.22+) plus `http.CrossOriginProtection` (Go 1.25+) covers this app's routing and CSRF needs. chi (v5.5.0, 2026-10-14) is actively maintained and only worth adding for route groups or subrouter middleware, or for its middleware package.

### Cited Findings
- Release history: go1.27.0 was released 2026-08-19, go1.26.0 on 2026-02-10, go1.25.0 on 2025-08-12 and go1.24.0 on 2025-02-11. The latest point releases are go1.27.3 and go1.26.10, both 2026-10-19 with `crypto/x509` security fixes. go1.25.14 was 2026-08-19. Policy: "Each major Go release is supported until there are two newer major releases", so Go 1.25 is now out of support — [go.dev/doc/devel/release](https://go.dev/doc/devel/release)
- Go 1.22 ServeMux patterns:
  - `[METHOD ][HOST]/[PATH]`, for example `GET /api/streams/{name}`.
  - `{name...}` matches the rest of the path, and `{$}` matches only the exact path (for example `/{$}`).
  - The most specific pattern wins, and conflicting patterns panic at registration.
  - A `GET` pattern also matches `HEAD`.
  - Wildcard values come from `r.PathValue("name")`.

  (Not re-fetched this session.) — [go.dev/blog/routing-enhancements](https://go.dev/blog/routing-enhancements), [pkg.go.dev/net/http#ServeMux](https://pkg.go.dev/net/http#ServeMux)
- Go 1.25 added `http.CrossOriginProtection`. It "implements protections against Cross-Site Request Forgery (CSRF) by rejecting non-safe cross-origin browser requests. It uses modern browser Fetch metadata, doesn't require tokens or cookies, and supports origin-based and pattern-based bypasses" — [go.dev/doc/go1.25](https://go.dev/doc/go1.25)
- `CrossOriginProtection` details:
  - "GET, HEAD, and OPTIONS methods are safe methods and are always allowed."
  - Cross-origin requests are detected with `Sec-Fetch-Site`, "or by comparing the hostname of the Origin header with the Host header."
  - Requests without either header "are currently assumed to be either same-origin or non-browser requests, and are allowed."
  - The zero value is valid.
  - `AddInsecureBypassPattern` uses ServeMux pattern syntax.
  - Its methods are `AddTrustedOrigin`, `Check`, `Handler` and `SetDenyHandler`.

  — [pkg.go.dev/net/http#CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection)
- Go 1.26 net/http changes: ServeMux trailing-slash redirects use 307 instead of 301. `httputil.ReverseProxy.Director` is deprecated in favour of `Rewrite` ("the Director hook is fundamentally unsafe"). `Client` cookies are scoped to `Request.Host` — [go.dev/doc/go1.26](https://go.dev/doc/go1.26)
- Go 1.27 net/http changes:
  - New `Server.MaxHeaderValueCount`.
  - HTTP/2 server honours RFC 9218 priority, which `Server.DisableClientPriority` turns off.
  - HTTP/1 `Response.Body` auto-drains on Close.
  - New `httptest.NewTestServer`, which runs on an in-memory network for `testing/synctest`.

  — [go.dev/doc/go1.27](https://go.dev/doc/go1.27)
- Go 1.27: `encoding/json` "is now backed by the v2 implementation". Behaviour is preserved, error texts may differ, and `GOEXPERIMENT=nojsonv2` opts out. `encoding/json/v2` "rejects invalid UTF-8 ... and rejects duplicate names" — [go.dev/doc/go1.27](https://go.dev/doc/go1.27)
- Go 1.27 requires macOS 13 or later, which affects release binaries for Mac users — [go.dev/doc/go1.27](https://go.dev/doc/go1.27)
- Go 1.27 `go test` runs the `stdversion` vet check by default — [go.dev/doc/go1.27](https://go.dev/doc/go1.27)
- Go 1.25 graduated `testing/synctest` from experiment — [go.dev/doc/go1.25](https://go.dev/doc/go1.25)
- chi status: not archived, last push 2026-10-18, latest release v5.5.0 (2026-10-14, middleware fixes). Its `go.mod` says "Chi supports the four most recent major versions of Go" with `go 1.24` — [GitHub API repos/go-chi/chi](https://api.github.com/repos/go-chi/chi), [chi go.mod](https://github.com/go-chi/chi/blob/master/go.mod), [chi v5.5.0 release](https://github.com/go-chi/chi/releases/tag/v5.5.0)

### Code sketch (stdlib only)
```go
api := http.NewServeMux()
api.HandleFunc("GET /api/streams", listStreams)
api.HandleFunc("GET /api/streams/{name}", getStream)       // r.PathValue("name")
api.HandleFunc("POST /api/streams/{name}/purge", purgeStream)
api.HandleFunc("GET /api/kv/{bucket}/keys/{key...}", getKey)

cop := http.NewCrossOriginProtection()
if devMode { _ = cop.AddTrustedOrigin("http://localhost:5173") }

root := http.NewServeMux()
root.Handle("/api/", requireSession(cop.Handler(api)))
root.Handle("GET /ws", requireSession(wsHandler))           // Origin is checked in the upgrade
root.HandleFunc("GET /launch", launch)                      // token -> cookie
root.Handle("GET /", spaHandler())
srv := &http.Server{Handler: hostAllowList(root), ReadHeaderTimeout: 10 * time.Second}
```

### Inferences
- Middleware composition is plain `func(http.Handler) http.Handler` wrapping. The app needs about four middlewares (host allow-list, session cookie, cross-origin protection, read-only enforcement), so chi's main advantages (`Route`/`Group` scoping and the `middleware` package) are optional.
- Stay on stdlib unless subtree-scoped middleware becomes awkward. chi is a low-risk addition later because its handlers are plain `http.Handler`.
- Set `go 1.26` (or 1.27) in `go.mod`. Go 1.25 is out of support under the two-release policy.
- If the app adopts Go 1.27, test the JSON API contract. The v2-backed `encoding/json` changes error strings, and the new v2 package is stricter about duplicate keys.
- `CrossOriginProtection` deliberately allows GET. The domain API must therefore never change state on GET. The WebSocket upgrade is a GET, so it is not covered and needs its own Origin check (see section 3).

### Gaps
- The full ServeMux and `PathValue` doc text was not retrieved this session, because the pkg.go.dev page was truncated. The pattern syntax above comes from the Go 1.22 docs and blog.
- I found no evidence of a Go 1.28 release or freeze-related net/http changes as of 2026-10-31.

## 3. WebSockets: coder/websocket vs gorilla/websocket; multiplexed WS vs SSE

### Takeaway
Use **github.com/coder/websocket** (v1.8.15, 2026-06-15, commits as recent as 2026-10-29). It is context-first, safe for concurrent writes, and its default Origin check matches this app's security model. gorilla/websocket is not archived, but it has been dormant since its last release (v1.5.3, June 2024) and last push (March 2025). Use one multiplexed WebSocket per tab with a subscribe/unsubscribe protocol and bounded per-subscription buffers. SSE would hit the 6-connections-per-host limit on HTTP/1.1 localhost, and it cannot carry client subscribe messages.

### Cited Findings
- coder/websocket status: not archived, last push 2026-10-30, last commit 2026-10-29, latest release v1.8.15 (2026-06-15), with v1.8.14 before it (2025-09-06) — [GitHub API repos/coder/websocket](https://api.github.com/repos/coder/websocket), [releases](https://github.com/coder/websocket/releases)
- The README says "Coder now maintains this project". nhooyr authored and maintained it from 2019 to 2024, when it was `nhooyr.io/websocket` — [github.com/coder/websocket](https://github.com/coder/websocket)
- README highlights: zero dependencies, "First class context.Context support", concurrent writes, Wasm, `wsjson` helpers, and full permessage-deflate. The README says gorilla supports only no-context-takeover. gorilla's advantages listed there are maturity, prepared writes and configurable buffer sizes — [github.com/coder/websocket](https://github.com/coder/websocket)
- coder/websocket Origin behaviour: `Accept` rejects cross-origin requests by default, and the request's own host is always authorized. `OriginPatterns` are matched with `path.Match`, case-insensitively, against the origin host, or against `scheme://host` if the pattern contains `://`. The docs advise against `*`. `InsecureSkipVerify` disables the check ("You probably want to use OriginPatterns instead") — [pkg.go.dev/github.com/coder/websocket](https://pkg.go.dev/github.com/coder/websocket)
- coder/websocket concurrency and deadlines:
  - "All methods may be called concurrently except for Reader and Read."
  - Only one `Writer` at a time; other callers block.
  - "On any error from any method, the connection is closed ... This applies to context expirations as well", so a write context timeout closes the connection.
  - `SetReadLimit` defaults to 32768 bytes.
  - `CloseRead` starts a reader goroutine for write-only connections and returns a context that is cancelled on close.
  - `Ping` waits for the pong and needs a concurrent reader.

  — [pkg.go.dev/github.com/coder/websocket](https://pkg.go.dev/github.com/coder/websocket)
- gorilla/websocket status: not archived, last push 2025-03-19, latest release v1.5.3 (2024-06-14) — [GitHub API repos/gorilla/websocket](https://api.github.com/repos/gorilla/websocket), [pkg.go.dev/github.com/gorilla/websocket](https://pkg.go.dev/github.com/gorilla/websocket)
- History: the Gorilla toolkit was archived on 2022-12-09 — [github.com/gorillaincubator](https://github.com/gorillaincubator). It was later unarchived; the current API status shows `archived: false`. The README says "The package API is stable" — [github.com/gorilla/websocket](https://github.com/gorilla/websocket)
- gorilla concurrency and Origin: "Connections support one concurrent reader and one concurrent writer". A nil `CheckOrigin` uses "a safe default" that fails the handshake when Origin is present and its host does not match Host. After a `SetWriteDeadline` timeout "the websocket state is corrupt and all future writes will return an error" — [pkg.go.dev/github.com/gorilla/websocket](https://pkg.go.dev/github.com/gorilla/websocket)
- SSE limits: "When not used over HTTP/2, SSE suffers from a limitation to the maximum number of open connections ... per browser ... (6)". The issue is marked "Won't fix" in Chrome and Firefox. SSE is "a one-way connection, so you can't send events from a client to a server" — [MDN: Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)

### Code sketch (one socket, many subscriptions, bounded backpressure)
```go
func wsHandler(w http.ResponseWriter, r *http.Request) {
    c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
        OriginPatterns: devOrigins, // e.g. []string{"localhost:5173"} in --dev; nil otherwise
    })
    if err != nil { return } // Accept already wrote 403 for a bad Origin
    defer c.CloseNow()
    c.SetReadLimit(64 << 10)
    ctx := r.Context()

    out := make(chan []byte, 256) // per-connection send queue
    go func() {                   // single writer goroutine
        for msg := range out {
            wctx, cancel := context.WithTimeout(ctx, 5*time.Second) // write deadline
            err := c.Write(wctx, websocket.MessageText, msg)
            cancel()
            if err != nil { return } // the conn is now closed by the library
        }
    }()
    for { // reader: subscribe/unsubscribe frames {"op":"sub","id":"t1","kind":"tail","subject":"orders.>"}
        var m clientMsg
        if err := wsjson.Read(ctx, c, &m); err != nil { return }
        // start/stop a subscription goroutine that does:
        // select { case out <- frame: default: drop or close with StatusPolicyViolation "slow consumer" }
    }
}
```

### Inferences
- coder/websocket's default (same-host only, opt-in `OriginPatterns`) is exactly the ADR's "reject unexpected Origin". Do not set `InsecureSkipVerify`. Still run the Host allow-list and session cookie middleware before `Accept`, because the Origin check alone does not stop DNS rebinding: the attacker's Origin and Host would both be `evil.example:port`.
- Backpressure: the library closes the connection when a write context expires, so a stuck browser tab costs at most one write timeout. Do the dropping in the per-connection queue rather than blocking NATS callbacks. For tails, drop and report "N messages skipped". For KV watches, close the connection or resync, because skipped KV updates leave the client with wrong state.
- Multiplexed WebSocket vs SSE: the app binds plain HTTP/1.1 on loopback (no TLS, so no HTTP/2). Several SSE streams across a few tabs would quickly use up the 6-connection budget and stall ordinary `fetch` API calls. A single WebSocket per tab avoids that, and it gives a client→server channel for subscribe/unsubscribe. SSE stays viable only as one multiplexed stream with REST calls for subscription changes.
- `wsjson` is fine for control frames. Large message payloads may need base64 or binary frames, because NATS payloads are arbitrary bytes.

### Gaps
- I did not fetch Coder's blog post on adopting the library, or a CHANGELOG for v1.8.15.
- I found no published 2026 statement from the gorilla maintainers about their plans. "Dormant" is an inference from the dates.

## 4. Localhost security: CSRF, DNS rebinding, Host/Origin checks, SameSite, token-in-URL bootstrap; how Jupyter, Vite (and Docker Desktop) do it

### Takeaway
Use layered defences, all enforced server-side:
1. A strict **Host allow-list** (loopback IP literals and `localhost` with the bound port). This defeats DNS rebinding.
2. An **Origin check** on unsafe methods (`http.CrossOriginProtection`) and on the WebSocket upgrade.
3. A **session cookie** that is HttpOnly, `SameSite=Strict`, has `Path=/`, has a port-specific name, and is obtained only from the printed launch token.

Jupyter Server implements the same three layers: a loopback-only Host check unless `allow_remote_access` is set, an Origin-vs-Host check with an `allow_origin` allow-list, and a startup token that sets a cookie. Vite's CVE-2025-24010 fix added the missing Host check (`server.allowedHosts`) and WebSocket Origin check.

### Cited Findings
**Jupyter Server**, source at commit e39ebd5, fetched via the GitHub API on 2026-10-31. Docs:
- Token authentication "is on by default". The token is generated at startup and "logged to the terminal". It can be presented in an `Authorization` header, as `?token=`, or in the login form. After a `?token=` visit "a cookie will be set in your browser". `jupyter server list` shows tokens. Setting `c.ServerApp.token = ""` and `c.ServerApp.password = ""` is "NOT RECOMMENDED" — [Jupyter Server security docs](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)
- `check_host()`:
  - It strips the port and the IPv6 brackets.
  - An IP literal is allowed if `addr.is_loopback`. Any other name must be in `local_hostnames` (default `["localhost"]`).
  - Everything else is blocked with "Blocking request with non-local 'Host' ... set ServerApp.allow_remote_access to disable the check".

  — [jupyter_server/base/handlers.py](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/base/handlers.py)
- The `allow_remote_access` help text says: "This protects against 'DNS rebinding' attacks, where a remote web server serves you a page and then changes its DNS to send later requests to a local IP, bypassing same-origin checks." Its default is computed from the bind address. It is False (the check is on) when listening on a loopback address, and True when binding to all interfaces (`ip == ""`) or a non-loopback address — [jupyter_server/serverapp.py](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/serverapp.py)
- `check_origin()` covers "cross-site API requests, including websockets":
  - It allows the request if `allow_origin == "*"`.
  - It allows the request if the Origin or Host header is missing. The code comment says the cross-site form-POST case "is handled by tornado's xsrf_token".
  - It allows the request if the Origin's netloc equals Host. Otherwise the request must match `allow_origin` exactly or the `allow_origin_pat` regex, or it is blocked with "Blocking Cross Origin API request".

  — [jupyter_server/base/handlers.py](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/base/handlers.py)
- Jupyter also has `check_referer()` and `check_xsrf_cookie()` (an `_xsrf` double-submit via Tornado) for non-API requests — [jupyter_server/base/handlers.py](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/base/handlers.py)
- `use_redirect_file` (default True): Jupyter opens the browser through a local `jpserver-...-open.html` redirect file rather than a URL on the command line. The help text says this "prevented the authentication token used to launch the browser from being visible", which matters on multi-user systems. It notes that this breaks on WSL and Chromebooks, where it can be disabled — [jupyter_server/serverapp.py](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/serverapp.py), [security docs](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)

**Vite, CVE-2025-24010 ([GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)):**
- Summary: "Vite allowed any websites to send any requests to the development server and read the response ... due to default CORS settings and lack of validation on the Origin header for WebSocket connections"
- Three causes:
  1. `server.cors` defaulted to `true` (`Access-Control-Allow-Origin: *`).
  2. The HMR WebSocket had no Origin validation. The fix can be opted out of with `legacy.skipWebSocketTokenCheck: true`.
  3. There was no Host check, which allowed DNS rebinding. The fix is the new `server.allowedHosts`.
- Affected versions: `<=4.5.5`, `5.0.0–5.4.11` and `6.0.0–6.0.8`. Patched in 4.5.6, 5.4.12 and 6.0.9.

  — [GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)
- `server.allowedHosts` defaults to `[]`, which still allows "`localhost` and domains under `.localhost` and all IP addresses". "Setting `server.allowedHosts` to `true` allows any website to send requests to your dev server through DNS rebinding attacks". The docs recommend "always using an explicit list of allowed hosts" — [vite.dev/config/server-options](https://vite.dev/config/server-options)

**General guidance:**
- OWASP:
  - `Sec-Fetch-Site` "should be the primary signal in a Fetch-Metadata-based policy", but a fallback "is a mandatory requirement".
  - "If the Origin header is present, verify that its value matches the target origin". "Missing headers and Origin: null are not evidence of a same-origin request".
  - SameSite "does not replace a proper CSRF defense in most deployments". Lax "sends cookies on cross-site top-level navigations that use safe HTTP methods"; Strict "prevents cookies from being sent with cross-site requests".
  - Custom request headers suit API endpoints because they rely on CORS preflight.
  - Using "the __Host- prefix in addition to the SameSite attribute is recommended".

  — [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- Filippo Valsorda (13 Aug 2025), who designed Go's `CrossOriginProtection`:
  - The algorithm:
    1. Allow GET, HEAD and OPTIONS.
    2. Allow an Origin on the trusted list.
    3. If `Sec-Fetch-Site` is present, allow only `same-origin` or `none`.
    4. If neither `Sec-Fetch-Site` nor Origin is present, allow.
    5. Otherwise allow only if the Origin host (including port) equals Host.
  - `Sec-Fetch-Site` is in all major browsers since 2023. It is sent to "trustworthy (HTTPS or localhost)" origins.
  - SameSite is "by design, not a cross-origin protection".

  — [words.filippo.io/csrf](https://words.filippo.io/csrf/)
- On the OWASP/Go disagreement: OWASP's phrasing ("mandatory" fallback, missing headers are "not evidence" of same-origin) is stricter than Go's step 4, which allows requests with neither header — [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) vs [pkg.go.dev CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection)
- RFC 6265 §8.5: "Cookies do not provide isolation by port". A cookie set by `localhost:8080` is sent to every other `localhost:*` server. (From RFC text; not re-fetched this session.) — [RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)
- Token generation: `crypto/rand.Text()` (Go 1.24+) "returns a cryptographically random string using the standard RFC 4648 base32 alphabet ... at least 128 bits of randomness". `rand.Read` "never returns an error" — [pkg.go.dev/crypto/rand#Text](https://pkg.go.dev/crypto/rand#Text)

### Code sketch (host allow-list, launch, session)
```go
func hostAllowList(port string, next http.Handler) http.Handler {
    ok := map[string]bool{"127.0.0.1:" + port: true, "localhost:" + port: true, "[::1]:" + port: true}
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if !ok[strings.ToLower(r.Host)] { http.Error(w, "unexpected Host", http.StatusMisdirectedRequest); return }
        next.ServeHTTP(w, r)
    })
}

var launchToken = rand.Text()                       // printed at startup
var sessions sync.Map                               // session id -> struct{}
cookieName := "natsui_session_" + port              // cookies aren't port-isolated

func launch(w http.ResponseWriter, r *http.Request) { // GET /launch?token=...
    t := r.URL.Query().Get("token")
    if subtle.ConstantTimeCompare([]byte(t), []byte(launchToken)) != 1 { http.Error(w, "bad token", 403); return }
    sid := rand.Text(); sessions.Store(sid, struct{}{})
    http.SetCookie(w, &http.Cookie{Name: cookieName, Value: sid, Path: "/", HttpOnly: true,
        SameSite: http.SameSiteStrictMode /* Secure only if serving HTTPS */})
    w.Header().Set("Referrer-Policy", "no-referrer")
    http.Redirect(w, r, "/", http.StatusSeeOther)    // strip the token from the URL bar/history
}
```

### Inferences
- The threats each layer handles:
  - **DNS rebinding.** Here the attacker's page is same-origin with itself (`evil.example:PORT`), so Origin equals Host and `CrossOriginProtection` passes. Only the **Host allow-list** stops it. The **session cookie** also stops it, because the browser holds the cookie for `localhost`/`127.0.0.1`, not `evil.example`. Jupyter and Vite both added Host checks for exactly this case (cited above).
  - **Cross-site CSRF from another tab.** `CrossOriginProtection` rejects it on unsafe methods. `SameSite=Strict` stops the cookie being sent at all, including on the WebSocket handshake.
  - **Cross-site WebSocket hijacking.** The coder/websocket Origin default rejects it.
- `SameSite=Strict` vs Lax: Strict means a link to the UI from elsewhere (a chat message, say) arrives without the cookie. That is acceptable, because the user re-opens the printed URL. The launch handler sets the cookie on a same-site redirect, so Strict does not break the bootstrap.
- Other ports on localhost: `localhost:5173` and `localhost:8080` are same-site but cross-origin, so cookie SameSite does not separate local apps on different ports. `CrossOriginProtection` does: its step 3 rejects `Sec-Fetch-Site: same-site`, and its step 5 compares ports. Because cookies are not port-isolated (RFC 6265 §8.5), give the cookie a port-specific name so two nats-ui instances do not overwrite each other. Any other local server will still *receive* the cookie, so keep session ids opaque and per-process.
- `__Host-` prefix and `Secure`: they require `Secure`. Browsers' handling of `Secure` cookies on `http://localhost` varies, and I did not verify it (see Gaps). Use plain `HttpOnly; SameSite=Strict; Path=/` on HTTP. Only add `Secure` and the `__Host-` prefix if the binary serves TLS on a non-loopback bind.
- Non-loopback binds: when bound to a non-loopback address, the Host allow-list must be replaced by an explicit list (`--allowed-host`), because LAN hostnames and IPs are legitimate there. This mirrors Jupyter's `allow_remote_access` and `local_hostnames`, and Vite's explicit `allowedHosts` advice. Never fall back to "allow any Host". The token and cookie still apply, as the ADR requires.
- Reject `Origin: null` on the WebSocket and on unsafe methods (per OWASP). Treat requests that carry neither `Sec-Fetch-Site` nor Origin (curl, scripts) as non-browser. They still need the cookie, which keeps the API scriptable only by someone who holds the token.

### Gaps
- **Docker Desktop:** I did not find or fetch primary documentation of how Docker Desktop's dashboard protects its local API (Host/Origin/token), so I make no claims about it.
- Browser-specific handling of `Secure` and `__Host-` cookies on `http://localhost` (Chrome/Firefox treat localhost as a secure context; Safari's behaviour) was not verified from primary sources.
- I did not check Jupyter's token-generation code; the docs only say it is random and generated at startup. Its handling of the `?token=` query, and whether it redirects to strip the token, were also not checked.
- Chrome's Private Network Access / Local Network Access restrictions on public→localhost requests were not researched. They are an additional browser-side layer that the app should not rely on.

## 5. Printing a clickable launch URL, opening the browser, and token lifetime

### Takeaway
Print `http://127.0.0.1:PORT/launch?token=…` on its own line, because terminals auto-link bare URLs. Optionally wrap it in an OSC 8 hyperlink. Open it with **github.com/cli/browser** (`browser.OpenURL`), the actively maintained fork. **github.com/pkg/browser** has not been touched since January 2024 and has no tagged releases. Make the *launch token* valid for the process lifetime (like Jupyter), because second tabs, other browsers and restarts of the browser need it. Make each *session* a fresh random id issued by the exchange, and redirect immediately so the token leaves the address bar. Offer a `--no-browser` flag and a Jupyter-style redirect-file option for shared machines.

### Cited Findings
- `cli/browser`: "Helpers to open URLs, readers, or files in the system default web browser". It is a fork that adds error wrapping and Go 1.21 support, with the API `browser.OpenURL(url)`, `OpenFile` and `OpenReader`. Status: not archived, last commit 2026-10-12, last push 2026-10-19 — [github.com/cli/browser](https://github.com/cli/browser), [GitHub API repos/cli/browser](https://api.github.com/repos/cli/browser)
- `pkg/browser`: same API (`OpenURL`, `OpenFile`, `OpenReader`, plus `Stdout`/`Stderr` variables). The README says "The choice of which browser is started is entirely client dependant". It is not archived, but its last commit and push were 2024-01-02 and it has no GitHub releases — [github.com/pkg/browser](https://github.com/pkg/browser), [GitHub API repos/pkg/browser](https://api.github.com/repos/pkg/browser)
- Jupyter keeps the token for the server's lifetime (`jupyter server list` shows running servers' tokens). It opens the browser through a redirect file by default, so the token is not visible on the command line — [Jupyter Server security docs](https://jupyter-server.readthedocs.io/en/latest/operators/security.html), [serverapp.py `use_redirect_file`](https://github.com/jupyter-server/jupyter_server/blob/main/jupyter_server/serverapp.py)
- `crypto/rand.Text()` gives a token of at least 128 bits, in base32, which is URL-safe without escaping — [pkg.go.dev/crypto/rand#Text](https://pkg.go.dev/crypto/rand#Text)

### Code sketch
```go
url := fmt.Sprintf("http://127.0.0.1:%s/launch?token=%s", port, launchToken)
fmt.Fprintf(os.Stderr, "nats-ui is running. Open:\n\n  %s\n\n", url)
// optional OSC 8 hyperlink for terminals that support it:
// fmt.Fprintf(os.Stderr, "\x1b]8;;%s\x1b\\%s\x1b]8;;\x1b\\\n", url, "Open nats-ui")
if !noBrowser {
    if err := browser.OpenURL(url); err != nil { // github.com/cli/browser
        log.Printf("could not open a browser: %v (open the URL above manually)", err)
    }
}
if !isLoopback(listenAddr) {
    log.Printf("WARNING: listening on %s; anyone who can reach it and has the token can use NATS credentials", listenAddr)
}
```

### Inferences
- **Single-use vs long-lived token.** A strictly single-use token breaks common cases: a second browser, a private window, a cleared cookie, or the auto-opened browser consuming the token before the user's preferred browser does. The user would then have to restart the binary.
  - Recommended compromise: the token stays valid until the process exits. Each exchange mints a new random session id held only in memory, so sessions die with the process. Redirect with `303` to `/` and send `Referrer-Policy: no-referrer` so the token does not stay in history or leak via Referer.
  - If stricter behaviour is wanted, use a `--single-use-token` flag, or rotate the token after the first exchange and print the new one. A "print a new launch URL" key or command is also possible.
- Compare tokens with `crypto/subtle.ConstantTimeCompare`. Never log the token after startup. Exclude it from access logs (log `r.URL.Path`, not `r.URL`).
- Command-line exposure: passing the URL to `xdg-open`/`open`/`rundll32` (which `cli/browser` does) exposes the token in the process list briefly on multi-user machines. This is the exact risk Jupyter's redirect file addresses. An optional `--browser-redirect-file` mode writes a 0600 HTML file containing a `meta refresh` to the launch URL and opens `file://` instead.
- Persisting the token across restarts (for bookmarks) would require storing it in a 0600 file in the user config directory. That widens the attack surface, and the GLOSSARY's "prints at startup" wording suggests per-start tokens, so keep tokens per-process unless users ask otherwise.

### Gaps
- I did not verify how `cli/browser` invokes the OS opener on each platform (exact commands and arguments), so the process-list exposure claim is an inference.
- OSC 8 hyperlink support across terminals was not researched from primary sources. Bare-URL auto-linking by terminals is common, but it is not cited here.
