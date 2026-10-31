# Testing and release engineering for nats-ui (Go binary, embedded React frontend, manages NATS)

Research date: 2026-10-31. Pinned versions checked: nats-server v2.15.2 (latest release), nats.go v1.55.0, jsm.go v0.5.1, natscli v0.5.1, GoReleaser v2.19.0, Go 1.27.3, Vitest 5.0.5, Playwright 1.64.1, Vite 8.3.5, TypeScript 7.0.2.

Method note: besides reading sources, two things were run locally in a throwaway scratchpad during this session: (a) a Go test module against nats-server v2.15.2 (single JetStream server + 3-node R3 cluster + WebSocket + system account), and (b) a Vitest 5 + RTL + React 19 + Vite 8 + TypeScript 7 project. Results from those runs are labelled "local run" and are measurements, not cited claims.

## Q1. Embedding nats-server in Go tests (Options API, test helpers, ports, JetStream, R3 cluster, $SYS/JWT, WebSocket, cost)

### Takeaway
Embed with `server.NewServer(&server.Options{...})` + `go s.Start()` + `s.ReadyForConnections(...)`, using `Port: -1` for random ports and `t.TempDir()` as `StoreDir`; the `github.com/nats-io/nats-server/v2/test` package is a normal (non-`_test.go`) package and is importable, but it only adds thin wrappers. The extra dependency weight for nats-ui is close to zero, because jsm.go (which nats-ui will use anyway) already imports `nats-server/v2/server`. A single JetStream server starts in about 30 ms. A 3-node cluster takes about 5 s before an R3 stream can be created, so keep cluster tests few and shared. Note that the NATS client libraries themselves (nats.go, jsm.go) moved in 2026 to Synadia's `orbit.go/ntf` test-fixture service rather than hand-rolled embedding.

### Cited Findings

**Core API (nats-server v2.15.2)**
- `func NewServer(opts *Options) (*Server, error)`, `(*Server).Start()`, `Shutdown()`, `WaitForShutdown()`, `ClientURL()`, `WebsocketURL()`, `MonitorAddr()`, `ClusterAddr()`, `InProcessConn()` and `ReadyForConnections(dur)` are all exported on `*server.Server` — [server.go L708, L1082, L1096, L2294, L2615, L2805, L2913, L3992, L4002, L4088](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L708)
- `ReadyForConnections` returns true once the client listener and, when configured, the route, gateway, leafnode, websocket and MQTT listeners are up. It does **not** wait for JetStream meta-leader election — [server.go readyForConnections](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L4088)
- `RANDOM_PORT = -1`: "when supplied, will cause the server to listen on a random port". `Port: 0` is replaced by `DEFAULT_PORT` (4222), so **0 does not mean random** — [const.go L80-L83](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L80-L83), [opts.go L6071-L6076](https://github.com/nats-io/nats-server/blob/v2.15.2/server/opts.go#L6065-L6077)
- WebSocket: `Websocket.Port == -1` is turned into port 0 (random), and TLS is required unless `NoTLS` is set. `WebsocketURL()` is documented as "Helpful in tests and with in-process servers using a random websocket port (-1)" — [websocket.go L1144-L1145, L1280-L1283](https://github.com/nats-io/nats-server/blob/v2.15.2/server/websocket.go#L1265-L1291), [server.go L1094-L1105](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L1094-L1105)
- Relevant `Options` fields: `ServerName, Host, Port, DontListen, Users, Accounts, SystemAccount, NoSystemAccount, HTTPPort, Cluster ClusterOpts, JetStream, JetStreamMaxMemory, JetStreamMaxStore, StoreDir, Websocket WebsocketOpts, Routes, TrustedOperators []*jwt.OperatorClaims, AccountResolver` — [opts.go L419-L542](https://github.com/nats-io/nats-server/blob/v2.15.2/server/opts.go#L419-L542); `WebsocketOpts{Host, Port, NoTLS, SameOrigin, AllowedOrigins}` — [opts.go L616-L684](https://github.com/nats-io/nats-server/blob/v2.15.2/server/opts.go#L616-L684)
- `server.ProcessConfigFile(path)` turns a nats-server config file into `*Options` (this is the easy route to per-account `jetstream: enabled`), and `RoutesFromStr` parses route URLs — [opts.go L968](https://github.com/nats-io/nats-server/blob/v2.15.2/server/opts.go#L968), [opts.go L6039](https://github.com/nats-io/nats-server/blob/v2.15.2/server/opts.go#L6039)
- `(*Account).EnableJetStream(limits map[string]JetStreamAccountLimits, tq chan<- func()) error` enables JetStream on an account built in Go — [jetstream.go L1192](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream.go#L1192); `MemAccResolver` exists for JWT mode — [accounts.go L4218](https://github.com/nats-io/nats-server/blob/v2.15.2/server/accounts.go#L4218)
- `InProcessConn()` "returns an in-process connection to the server, avoiding the need to use a TCP listener… regardless of the state of the DontListen option" — [server.go L2908-L2923](https://github.com/nats-io/nats-server/blob/v2.15.2/server/server.go#L2908-L2923)

**The `test` package (importable)**
- `github.com/nats-io/nats-server/v2/test/test.go` is `package test`, a regular non-`_test` file. It exports `DefaultTestOptions` (Host 127.0.0.1, Port 4222, NoLog, NoSigs), `RunDefaultServer()`, `RunRandClientPortServer()` (Port -1), `RunServer(opts)`, `RunServerCallback`, `LoadConfig`, `RunServerWithConfig(file)` and `RunServerWithConfigOverrides`. `RunServer` panics on failure, forces `Cluster.PoolSize=-1` and compression off, and honours `NATS_LOGGING=debug|trace` — [test/test.go L43-L147](https://github.com/nats-io/nats-server/blob/v2.15.2/test/test.go#L43-L147)
- The rich JetStream cluster helpers (`createJetStreamClusterExplicit` and similar) live in `server/*_test.go` files, so they cannot be imported. Only `test/test.go` is importable — [nats-server test dir listing](https://github.com/nats-io/nats-server/tree/v2.15.2/test)
- nats-server v2.15.2 module dependencies: antithesis-sdk-go, go-tpm, klauspost/compress, minio/highwayhash, nats-io/jwt/v2, nats.go, nkeys, nuid, x/crypto, x/sys, x/time; `go 1.26.0` — [go.mod](https://github.com/nats-io/nats-server/blob/v2.15.2/go.mod)

**How natscli does it (hand-rolled embedding, most similar to nats-ui)**
- `setupJStreamTest`: `server.NewServer(&server.Options{Port: -1, ServerName, StoreDir: os.MkdirTemp(...), JetStream: true, SystemAccount: "SYS", Accounts: []*server.Account{sysAcc}, Users: [{sys/pass, Account: sysAcc}]})`, then `go srv.Start()` and `ReadyForConnections(10*time.Second)` — [natscli nats/tests/nats_test.go L211-L253](https://github.com/nats-io/natscli/blob/e62a4c123040/nats/tests/nats_test.go#L211-L253)
- `createServersWithCallback` builds a 3-node cluster with **fixed** cluster ports `12000+i`, a full `Routes` list on every node, `Cluster{Name: "TEST"}`, per-node `StoreDir` and `LogFile`, and skips cluster tests on Windows "due to GitHub Actions resource constraints" — [nats_test.go L270-L330](https://github.com/nats-io/natscli/blob/e62a4c123040/nats/tests/nats_test.go#L270-L330)
- Fixtures are seeded through jsm.go (`mgr.NewStream("TEST_STREAM", opts...)`, `createDefaultTestStream(t, mgr, replicas)`) and natscli is run as a subprocess against the server's `ClientURL()` — [nats_test.go L65-L209](https://github.com/nats-io/natscli/blob/e62a4c123040/nats/tests/nats_test.go#L65-L209)
- natscli CI runs `go test -v --failfast -p=1` (packages serially) — [natscli release.yaml](https://github.com/nats-io/natscli/blob/e62a4c123040/.github/workflows/release.yaml)

**How NUI (nats-nui/nui, an open-source NATS GUI with the same architecture) does it**
- `pkg/testserver` wraps `server.NewServer` with options such as `WithPort`, `WithDefaultAccount()`, `WithSysAccount("sys")` and `WithTLS`. After start it calls `acc.EnableJetStream(nil, nil)` on every configured account — [nui pkg/testserver/testserver.go L20-L135](https://github.com/nats-nui/nui/blob/71d1487c47cc/pkg/testserver/testserver.go#L20-L135)
- Its tests are a testify `suite` that starts the embedded NATS server and the NUI HTTP server, then drives the HTTP API with `gavv/httpexpect/v2` — [nui tests/suite.go](https://github.com/nats-nui/nui/blob/71d1487c47cc/tests/suite.go)

**How nats.go and jsm.go do it in 2026 (ntf test service)**
- nats.go's JetStream tests now use `github.com/synadia-io/orbit.go/ntf-client`: `withJSServer`, `withJSCluster(t, size, ...)` → `c.CreateCluster(t, size, true)`, plus readiness waits (`waitForJSCluster` loops `js.AccountInfo` until the meta leader exists). The comments explain why `StartServer` returning "on ack, not on readiness" means you must wait for a stream leader — [nats.go jetstream/test/testservice_helper_test.go](https://github.com/nats-io/nats.go/blob/36314d4086cb/jetstream/test/testservice_helper_test.go)
- nats.go `TestMain` uses `TESTER_NATS_URL` when set. Otherwise it starts the in-process tester with `ntf.New(ctx, ntf.Options{AdvertiseHost: "localhost"})`, and CI refuses to fall back to in-process ("CI must use the pinned synadia/ntf-server image") — [nats.go jetstream/test/main_test.go](https://github.com/nats-io/nats.go/blob/36314d4086cb/jetstream/test/main_test.go)
- nats.go keeps nats-server out of its main `go.mod` by using a separate `go_test.mod`, where nats-server v2.15.0 is listed as indirect — [nats.go go_test.mod](https://github.com/nats-io/nats.go/blob/36314d4086cb/go_test.mod)
- jsm.go `test/main_test.go` calls `RunWithNTF(m, 20000)` and `ntfc.WithJetStreamServer(...)`. jsm.go's go.mod requires nats-server v2.15.2 and orbit.go/ntf v0.0.2 / ntf-client v0.0.4 — [jsm.go test/main_test.go](https://github.com/nats-io/jsm.go/blob/74725fff877c/test/main_test.go), [jsm.go go.mod](https://github.com/nats-io/jsm.go/blob/74725fff877c/go.mod)
- ntf: "runs NATS servers, clusters and super-clusters on demand, so tests can talk to real servers over real connections instead of embedding one." The zero-value `ntf.New(ctx, ntf.Options{})` "starts an embedded server on an OS-chosen port", and the default backend is `inprocess` (it imports `nats-server/v2/server`). Managed servers "bind the wildcard address" — [orbit.go ntf README](https://github.com/synadia-io/orbit.go/blob/16d67fa064b8/ntf/README.md), [ntf/inprocess.go](https://github.com/synadia-io/orbit.go/blob/16d67fa064b8/ntf/inprocess.go)
- ntf-client API: `WithServer/WithJetStreamServer`, `WithCluster/WithJetStreamCluster`, `WithSuperCluster`, `CreateCluster(t, n, js)`, and option snippets `WithAccounts`, `WithAuthorization`, `WithWebSocket(snippet)` (`{{ .Ports.websocket }}` port reservation), `WithGeneratedTLS()`, `WithConnectOptions(nats.UserInfo(...))`. The CI image is `synadia/ntf-server:<tag>` and needs host networking or a job container, because "Bridge networking with -p port mapping is not supported" — [orbit.go ntf-client README](https://github.com/synadia-io/orbit.go/blob/16d67fa064b8/ntf-client/README.md)

**JWT / operator mode fixtures**
- nats-server's own operator-mode fixture is just `listen`, `operator = "./configs/nkeys/op.jwt"`, `resolver = MEMORY` — [test/configs/operator.conf](https://github.com/nats-io/nats-server/blob/v2.15.2/test/configs/operator.conf)

### Inferences

**Local run (Go 1.27.3, nats-server v2.15.2, nats.go latest, linux/amd64):**
- Single server with JetStream, HTTP monitoring, a WebSocket listener, SYS+APP accounts: ready in **~27 ms**. Creating a stream, a `$SYS.REQ.SERVER.PING.VARZ` request as the sys user, and a WebSocket connect all finished by **~30 ms**.
- 3-node cluster: all three listening after **~80 ms**, but the first successful R3 `CreateStream` came at **~5.2 s** (consistent across two runs). JetStream meta-leader election dominates. Treat the cluster as a shared fixture: one per package via `TestMain`, or a `sync.Once`, not one per test.
- First `go test` including module download and compile: ~23 s wall. Warm runs: ~5.3 s total, almost all of it the cluster.
- Two gotchas reproduced: (1) with explicit `Options.Accounts`, `JetStream: true` alone gives `JetStream not enabled for account (10039)`. You must use `jetstream: enabled` in a config or `acc.EnableJetStream(nil, nil)` after start, as NUI does. (2) A clustered JetStream server with no routes dies with `[FTL] Can't start JetStream: JetStream cluster requires configured routes or solicited leafnode for the system account`. Every node, the seed included, needs the full routes list. That is why natscli pre-assigns cluster ports.
- Dependency weight: `go list -deps github.com/nats-io/jsm.go` already includes `nats-server/v2/server`, `/conf`, `/logger` and `/internal/ldap`, because jsm.go's `manager.go` and `events.go` import the server package. So nats-ui's production binary already links the server package, and embedding it in tests adds no new modules. The module graph for the test module was 25 modules.

**Recommended helper (config-string route, verified working in the local run):**
```go
// internal/natstest/natstest.go  (non-_test file so e2e harness can reuse it)
func Run(t testing.TB, conf string) *server.Server {
	t.Helper()
	f := filepath.Join(t.TempDir(), "server.conf")
	os.WriteFile(f, []byte(conf), 0o600)
	o, err := server.ProcessConfigFile(f)
	if err != nil { t.Fatal(err) }
	o.NoLog, o.NoSigs = true, true
	s, err := server.NewServer(o)
	if err != nil { t.Fatal(err) }
	go s.Start()
	if !s.ReadyForConnections(10 * time.Second) { t.Fatal("nats not ready") }
	t.Cleanup(func() { s.Shutdown(); s.WaitForShutdown() })
	return s
}

const single = `
listen: 127.0.0.1:-1
http: 127.0.0.1:-1                    # Monitoring URL fallback tests
server_name: s1
jetstream { store_dir: %q }           # t.TempDir()
websocket { listen: 127.0.0.1:-1, no_tls: true }
accounts {
  SYS { users: [{user: sys, password: s}] }               # System credentials
  APP { jetstream: enabled, users: [{user: app, password: a}] }
}
system_account: SYS
`
```
- R3 cluster: pre-pick 3 free ports (listen on `127.0.0.1:0`, record, close; a small race, but fine locally), then give every node `cluster { name: C, listen: 127.0.0.1:<p_i>, routes: [all three] }`, `listen: 127.0.0.1:-1`, and its own `store_dir`. Before asserting, poll `js.AccountInfo` or `CreateStream` until it succeeds, as nats.go's `waitForJSCluster` does.
- JWT/operator mode for $SYS tests: generate operator, system-account and account keys with `nkeys`, encode `jwt.NewOperatorClaims` / `jwt.NewAccountClaims`, and write a config with `operator: <jwt>`, `system_account: <SYS pubkey>`, `resolver: MEMORY`, `resolver_preload: {<pub>: <jwt>}`. Or set `Options.TrustedOperators` plus `AccountResolver: &server.MemAccResolver{}` and `Store` the account JWTs. Users then connect with `nats.UserJWTAndSeed`. This exercises the "System credentials" path for real.
- When to use ntf instead: if nats-ui wants super-clusters, leafnodes, link faults (toxics) or TLS generation later, `orbit.go/ntf` in in-process mode gives that with no Docker. It is v0.0.x, though, and binds the wildcard address. For the agreed scope (single server, R3 cluster, $SYS, WebSocket), the ~40-line hand-rolled helper above is enough and has no extra dependency.
- `t.Parallel()` is safe with `-1` ports and per-test `TempDir`. Keep the cluster serial, or give it a dedicated package, since natscli runs `-p=1` and skips clusters on Windows CI.

### Gaps
- No published benchmark of embedded-server startup cost exists. The numbers above come from one local machine.
- Whether `RaftConfig`-style election timeouts can be lowered from outside the `server` package, to cut the ~5 s cluster warm-up, was not found. The fast timeouts in nats-server's own tests are set through unexported package variables in `_test.go` files (not verified line by line).
- Exact lines of a JWT-mode example in nats.go or natscli tests were not pulled. The sketch is assembled from Options fields and the operator.conf fixture.

## Q2. Playwright against the Go server: launching, seeding, webServer config, Launch token

### Takeaway
Use Playwright's `webServer` with `command: go run ./internal/e2e/cmd/e2eserver` (or a prebuilt binary). That harness starts the embedded NATS fixture, seeds it, starts the real nats-ui HTTP handler on `127.0.0.1:0`, and prints one line with the URL and Launch token. Playwright 1.57+ `wait.stdout` named capture groups put both into `process.env`, and a `setup` project exchanges the token for the session cookie and saves `storageState`.

### Cited Findings
- `webServer` options: `command`, `cwd`, `env` (inherits `process.env` with `PLAYWRIGHT_TEST=1`), `gracefulShutdown` (default is SIGKILL of the process group), `name`, `reuseExistingServer`, `stdout`/`stderr`, `timeout` (default 60000), `url` (expects 2xx/3xx/400/401/402/403), `port` (deprecated, "Use url instead") — [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver)
- `wait`: "Consider command started only when given output has been produced", taking `{stdout, stderr}` regexes. "Named capture groups in the regex are stored in the environment": `/Listening on port (?<my_server_port>\d+)/` sets `process.env['MY_SERVER_PORT']`. If both `url` and `wait` are set, the server counts as started when at least one condition is met. An array of webServers is supported — [playwright.dev/docs/test-webserver](https://playwright.dev/docs/test-webserver)
- `wait` was added in 1.57 and `gracefulShutdown` in 1.50. The latest release is 1.64 (WebMCP, `--shuffle`, `Locator.within()`) — [Playwright release notes](https://playwright.dev/docs/release-notes); `@playwright/test` 1.64.1 is on npm, published 2026-10-31 — [npm @playwright/test](https://www.npmjs.com/package/@playwright/test)
- Auth pattern: a `setup` project (`*.setup.ts`) logs in once and calls `page.context().storageState({ path: 'playwright/.auth/user.json' })`. Other projects set `dependencies: ['setup']` and `use: { storageState }`. The docs say to gitignore `playwright/.auth` because it holds impersonation-capable cookies — [playwright.dev/docs/auth](https://playwright.dev/docs/auth)
- Seeding prior art: natscli seeds JetStream through jsm.go (`mgr.NewStream`, `createDefaultTestStream`) against an embedded server before running the CLI — [natscli nats_test.go L187-L209](https://github.com/nats-io/natscli/blob/e62a4c123040/nats/tests/nats_test.go#L187-L209). NUI's Go suite starts the embedded server plus the app server and drives the HTTP API — [nui tests/suite.go](https://github.com/nats-nui/nui/blob/71d1487c47cc/tests/suite.go). Temporal ui-server keeps `e2e/playwright-report` and `e2e/storageState.json` in `.gitignore`, which shows a Playwright + storageState setup in a Go-served UI repo — [temporalio/ui-server .gitignore](https://github.com/temporalio/ui-server/blob/9ba7e3c8b2c2/.gitignore)

### Inferences
- Do **not** add a test mode to the shipped binary (for example `--seed-fixtures` or `--no-token`). A separate `internal/e2e/cmd/e2eserver` main package reuses `internal/natstest` (Q1) and the real `http.Handler`, so the Launch-token, Host and Origin checks from ADR-0001 stay in force during e2e. The shipped binary gains no backdoor.
- Harness sketch:
```go
// internal/e2e/cmd/e2eserver/main.go
func main() {
	ns := natstest.MustRun(natstest.Single)          // embedded JetStream, SYS+APP, ws
	seed(ns.ClientURL())                              // streams ORDERS (10k msgs, some 2 MB), KV CONFIG, R1 consumer
	cfgDir, _ := os.MkdirTemp("", "nats-ui-e2e")      // isolated config dir + file Vault with key file
	writeContext(cfgDir, "local", ns.ClientURL(), "app", "a", sysCreds)
	srv, token := app.New(app.Options{ConfigDir: cfgDir, Addr: "127.0.0.1:0", VaultKeyFile: ...})
	go srv.Serve()
	fmt.Printf("E2E READY url=%s token=%s\n", srv.URL(), token)  // one parseable line
	waitForSignal(); srv.Shutdown(ctx); ns.Shutdown()
}
```
```ts
// playwright.config.ts
export default defineConfig({
  webServer: {
    command: 'go run ./internal/e2e/cmd/e2eserver',
    cwd: '..',                                         // repo root if config lives in web/
    wait: { stdout: /E2E READY url=(?<e2e_url>\S+) token=(?<e2e_token>\S+)/ },
    timeout: 120_000,                                  // first `go run` compiles
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    reuseExistingServer: false,
  },
  use: { baseURL: process.env.E2E_URL },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/session.json' }, dependencies: ['setup'] },
  ],
});
// auth.setup.ts
setup('exchange launch token', async ({ page }) => {
  await page.goto(`/?token=${process.env.E2E_TOKEN}`);   // or whatever the token-exchange route is
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.context().storageState({ path: 'playwright/.auth/session.json' });
});
```
- Check: `use.baseURL` reads `process.env.E2E_URL` when the config module loads. Whether captured `wait` env vars exist at config evaluation time (they may only be set after webServer start, before workers spawn) is unclear from the docs. The safe pattern reads them inside tests or the setup project (`process.env.E2E_URL`) and calls `page.goto(new URL(path, process.env.E2E_URL).href)`. Worth a 10-minute spike.
- In CI, prefer `go build -o bin/e2eserver ./internal/e2e/cmd/e2eserver` in an earlier step and `command: ./bin/e2eserver`, so the compile time stays outside the 60 s default timeout.
- Seed fixtures in Go (jsm.go / nats.go jetstream) inside the harness. This matches natscli and gives deterministic sequences for ADR-0003 cases: gaps after delete or purge, large payloads, and a raised `max_payload` in the config.

### Gaps
- Not verified whether `wait`-captured variables are visible when `playwright.config.ts` is evaluated.
- No natscli Playwright usage exists (natscli has no web UI). No public NATS-related project using Playwright with an embedded nats-server was found.

## Q3. Frontend tests: Vitest + React Testing Library on Vite 8 / React 19 / TypeScript 7

### Takeaway
Current stack: Vitest 5.0.5 + jsdom 30 + @testing-library/react 16.3.3 (+ dom 10.4.2, user-event 14.6.8, jest-dom 7.0.1). It works as-is on Vite 8.3.5 + React 19 + TypeScript 7.0.2. Verified locally: 1 test ran in 554 ms and `tsc --noEmit` (TS 7) passed. TypeScript 7 does not affect test execution, because Vite and Vitest transpile TS themselves. It affects only typechecking, and only through two things: `types` now defaults to `[]`, and TS 7 ships no JS API. Vitest Browser Mode (Playwright provider + `vitest-browser-react` 2.3.0) is the main alternative to jsdom.

### Cited Findings
- npm versions as of 2026-10-31: vitest 5.0.5, @vitest/browser-playwright 5.0.5, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.8, @testing-library/jest-dom 7.0.1, jsdom 30.1.3, happy-dom 21.0.4, vitest-browser-react 2.3.0, msw 3.0.3, vite 8.3.5, @vitejs/plugin-react 6.1.2, typescript 7.0.2 — [npm vitest](https://www.npmjs.com/package/vitest), [npm @testing-library/react](https://www.npmjs.com/package/@testing-library/react), [npm vitest-browser-react](https://www.npmjs.com/package/vitest-browser-react), [npm typescript](https://www.npmjs.com/package/typescript)
- Vitest 5 peer range `vite: ^6.4.0 || ^7.0.0 || ^8.0.0` and engines `node ^22.12.0 || ^24.0.0 || >=26.0.0`. RTL 16 peers `react ^18 || ^19`, `@testing-library/dom ^10`. vitest-browser-react peers `vitest ^4 || ^5` — [npm vitest](https://www.npmjs.com/package/vitest?activeTab=dependencies), [npm @testing-library/react](https://www.npmjs.com/package/@testing-library/react?activeTab=dependencies)
- Vitest 5.0 (announced 2026-09-03): "requires Vite >= 6.4.0 and Node.js >= 22.12.0". Browser Mode Trace View; locators "strict by default". Inline projects inherit the root config. `clearMocks` now defaults to `true`. `fsModuleCache` is stable. Reporter output goes to `.vitest/` — [vitest.dev/blog/vitest-5](https://vitest.dev/blog/vitest-5)
- Browser Mode: `npx vitest init browser`; `browser.enabled: true` with `provider: playwright()` from `@vitest/browser-playwright` and `instances: [{ browser: 'chromium' }]`; React components via `render` from `vitest-browser-react` and `await expect.element(...)`; `projects` can mix node/jsdom and browser suites — [vitest.dev/guide/browser](https://vitest.dev/guide/browser/)
- jest-dom with Vitest: `import '@testing-library/jest-dom/vitest'` in a file listed in `setupFiles` — [jest-dom README "With Vitest"](https://github.com/testing-library/jest-dom#with-vitest)
- TypeScript 7.0 (2026-07-08) ships in the regular `typescript` package (`tsc`). It "does not ship with an API" (expected in 7.1), so tools needing programmatic access (for example typescript-eslint) need 6.0 via `@typescript/typescript6` (`tsc6`) and npm aliasing. 6.0 deprecations are now hard errors (`target: es5`, `moduleResolution node/node10/classic`, `baseUrl`, …). New defaults: `strict: true`, `module: esnext`, **`types: []`**, `rootDir: ./` — [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

### Inferences
- **Local run** (fresh project with vitest 5.0.5, jsdom 30.1.3, vite 8.3.5, typescript 7.0.2, React 19): `vitest run` passed (Duration 554 ms, 0.9 s wall) and `tsc --noEmit` with TS 7.0.2 passed. Two adjustments were needed: (1) a `test` key in `vite.config.ts` fails to typecheck under TS 7 unless the file has `/// <reference types="vitest/config" />` (or imports `defineConfig` from `vitest/config`); (2) because `types` now defaults to `[]`, list `"types": ["vite/client", "@testing-library/jest-dom/vitest"]` (add `"vitest/globals"` only if `globals: true`).
- Working config:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', environment: 'jsdom', include: ['src/**/*.test.tsx'], setupFiles: ['./src/test-setup.ts'] } },
      // optional later: { extends: true, test: { name: 'browser', include: ['src/**/*.browser.test.tsx'],
      //   browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] } } },
    ],
  },
})
// src/test-setup.ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(() => cleanup())
```
- Use MSW 3 (or a fake `fetch` / WebSocket) to stub the domain API in component tests, and keep real NATS for the Go and Playwright layers.
- If ESLint with type-aware rules (typescript-eslint) is adopted, the TS 6 alias dance from the TS 7 post is needed until TS 7.1's API ships. `tsc` (7) still does the CI typecheck. Vitest's own `typecheck` mode shells out to `tsc`. Whether it parses TS 7 output correctly was not verified, so it is simpler to run `tsc --noEmit` as a separate script.
- jsdom vs Browser Mode: jsdom is enough for most components. A virtualised message table (ADR-0003) depends on real layout (element heights, scroll), which jsdom does not compute. Test that in Vitest Browser Mode or Playwright.

### Gaps
- Not found: an official statement from Vitest on TypeScript 7 / tsgo compatibility for `vitest --typecheck`.
- The Vitest 5 migration guide was not read in full, so other breaking changes may exist beyond those the announcement lists.

## Q4. Release: GoReleaser, cross-compiling, CGO, checksums, SBOM, signing, notarization, GitHub Actions, and `go install` with embedded assets

### Takeaway
GoReleaser v2 OSS covers everything needed: a global `before.hooks` that runs the npm build, `CGO_ENABLED=0` for linux/darwin/windows × amd64/arm64, `checksum`, `sboms` (syft), and `signs` with cosign keyless `--bundle`. macOS sign and notarize works from Linux through the built-in quill (`notarize.macos`), but needs a paid Apple Developer ID. zalando/go-keyring does **not** need cgo on any of the six targets (verified by building). For `go install …@latest`, the frontend `dist/` must be **committed** (or come from a mirror repo with built assets), because `go install` never runs npm or `go generate` and module zips contain only committed files. PocketBase and Temporal ui-server do this. Gitea and NUI do not, and their `go install` builds lack the frontend.

### Cited Findings

**GoReleaser**
- Latest GoReleaser is v2.19.0 — [goreleaser releases](https://github.com/goreleaser/goreleaser/releases)
- Global `before: hooks:` runs "before the release is started", and a failing hook aborts the release. Templates are allowed. The extended per-hook form (`cmd`, `dir`, `output`, `env`, `if` since v2.7) is documented. The page's placement of a "GoReleaser Pro" banner makes it unclear which parts are Pro-only — [goreleaser.com/customization/hooks](https://goreleaser.com/customization/hooks/). GoReleaser's own OSS config uses simple string hooks (`go mod tidy`, `./scripts/completions_and_manpages.sh`) — [goreleaser .goreleaser.yaml](https://github.com/goreleaser/goreleaser/blob/538a99ed8f82/.goreleaser.yaml)
- Build defaults: ldflags `-s -w -X main.version={{.Version}} -X main.commit={{.Commit}} -X main.date={{.Date}} -X main.builtBy=goreleaser`; `mod_timestamp` can be `{{.CommitTimestamp}}` for reproducible builds; `-trimpath` is recommended via `flags`; per-build `hooks.pre/post`; default goos darwin/linux/windows, goarch 386/amd64/arm64 — [goreleaser.com/customization/builds/go](https://goreleaser.com/customization/builds/go/)
- SBOM: `sboms:` defaults to `cmd: syft`, `artifacts: archive`, args `["$artifact","--output","spdx-json=$document","--enrich","all"]`, document `{{ .ArtifactName }}.sbom.json`; `artifacts: binary` is also supported — [goreleaser.com/customization/sbom](https://goreleaser.com/customization/sbom/). nats-server uses `sboms: - artifacts: binary` with `...sbom.spdx.json` names — [nats-server .goreleaser.yml L113-L118](https://github.com/nats-io/nats-server/blob/v2.15.2/.goreleaser.yml#L113-L118)
- Signing: `signs: - cmd: cosign, signature: "${artifact}.sigstore.json", args: ["sign-blob","--bundle=${signature}","${artifact}","--yes"], artifacts: checksum`. The `--bundle` flag "combines the certificate and signature into a single .sigstore.json file" — [goreleaser.com/customization/sign](https://goreleaser.com/customization/sign/); GoReleaser signs its own releases the same way — [goreleaser .goreleaser.yaml L371-L379](https://github.com/goreleaser/goreleaser/blob/538a99ed8f82/.goreleaser.yaml)
- Current tool versions: cosign v3.1.4, sigstore/cosign-installer v4.1.2, syft v1.55.0, anchore/sbom-action v0.24.3, goreleaser-action v7.3.0, actions/attest v4.2.2, actions/setup-node v7.1.0 — [cosign releases](https://github.com/sigstore/cosign/releases), [cosign-installer](https://github.com/sigstore/cosign-installer/releases), [syft](https://github.com/anchore/syft/releases), [sbom-action](https://github.com/anchore/sbom-action/releases), [goreleaser-action](https://github.com/goreleaser/goreleaser-action/releases), [actions/attest](https://github.com/actions/attest/releases), [setup-node](https://github.com/actions/setup-node/releases)
- Verification: `cosign verify-blob <file> --bundle artifact.sigstore.json --certificate-identity=… --certificate-oidc-issuer=…` — [docs.sigstore.dev verify](https://docs.sigstore.dev/cosign/verifying/verify/)
- GitHub artifact attestations as an alternative or addition: `actions/attest@v4` with `subject-path` (and `sbom-path`), permissions `id-token: write`, `attestations: write`, `contents: read`; verify with `gh attestation verify <binary> -R owner/repo` — [GitHub Docs: artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- macOS: the cross-platform `notarize.macos` uses anchore/quill built in, "has no external dependencies, and works on any operating system". For bare binaries, "If you only need to sign and notarize your binaries, this is probably the best alternative". It needs an Apple Developer account ($99/yr), a "Developer ID Application" `.p12` with password, and an App Store Connect API key (`.p8`, key ID, issuer ID), passed base64 in env. The native method is Pro — [goreleaser.com/customization/notarize](https://goreleaser.com/customization/notarize/). GoReleaser's own config gates it with `enabled: '{{ isEnvSet "MACOS_SIGN_P12" }}'` — [goreleaser .goreleaser.yaml L59-L68](https://github.com/goreleaser/goreleaser/blob/538a99ed8f82/.goreleaser.yaml)
- `gomod.proxy: true` builds from proxy.golang.org so `go version -m` shows module info. It applies only on tags, `build.main` must be a package, and "VCS Info will not be embedded" — [goreleaser.com/customization/verifiable_builds](https://goreleaser.com/customization/verifiable_builds/)
- natscli release (a reference NATS tool): tag-triggered workflow with `permissions: contents: write, id-token: write`, `actions/checkout` with `fetch-depth: 0`, setup-go `stable`, lint, then tests, then `goreleaser/goreleaser-action` `version: "~> v2"`, `args: release --clean`. `.goreleaser.yml` builds with `CGO_ENABLED=0` for darwin/linux/windows/freebsd, zip archives, `checksum: name_template: SHA256SUMS`, brews and nfpms, and no SBOM or signing — [natscli release.yaml](https://github.com/nats-io/natscli/blob/e62a4c123040/.github/workflows/release.yaml), [natscli .goreleaser.yml](https://github.com/nats-io/natscli/blob/e62a4c123040/.goreleaser.yml)
- nats-server pins the release toolchain with `GOTOOLCHAIN={{ envOrDefault "GORELEASER_TOOLCHAIN" "go1.27.3" }}` and sets version via `-X …serverVersion={{.Tag}}` — [nats-server .goreleaser.yml L19-L25](https://github.com/nats-io/nats-server/blob/v2.15.2/.goreleaser.yml#L19-L25)

**CGO / go-keyring**
- go-keyring: "The OS X implementation depends on the `/usr/bin/security` binary". It shells out (`execPathKeychain = "/usr/bin/security"`) instead of linking Security.framework — [go-keyring README](https://github.com/zalando/go-keyring/blob/66b55cc0c51c/README.md#dependencies), [keyring_darwin.go L29](https://github.com/zalando/go-keyring/blob/66b55cc0c51c/keyring_darwin.go#L29). On Linux it uses `godbus/dbus/v5` (Secret Service) and on Windows `danieljoos/wincred` + `x/sys/windows` (pure Go) — [go-keyring repo](https://github.com/zalando/go-keyring)

**`go install` and embedded frontends**
- "Go generate is never run automatically by go build, go test, and so on" — [cmd/go docs](https://pkg.go.dev/cmd/go#hdr-Generate_Go_files_by_processing_source). For `go install pkg@version`, the module's go.mod "must not contain directives (replace and exclude)" that would change its interpretation as the main module — [cmd/go docs](https://pkg.go.dev/cmd/go)
- `//go:embed`: "each pattern … must match at least one file or non-empty directory". Files starting with `.` or `_` are excluded unless the pattern has the `all:` prefix. "Patterns must not match files outside the package's module" — [pkg.go.dev/embed](https://pkg.go.dev/embed)
- **PocketBase** commits its built admin UI: `ui/dist/` is in the repo, `ui/embed.go` has `//go:build !no_ui` + `//go:embed all:dist`, and `ui/embed_no_ui.go` exists for a no-UI build tag — [pocketbase ui/embed.go](https://github.com/pocketbase/pocketbase/blob/7f2773ec234b/ui/embed.go), [pocketbase ui/ tree](https://github.com/pocketbase/pocketbase/tree/7f2773ec234b/ui)
- **Temporal UI**: `temporalio/ui-server` "is automatically updated to mirror changes to temporalio/ui/tree/main/server", with commits like "Sync from UI commit ea336ab…". It embeds committed built assets with `//go:embed all:assets` (`ui/assets/local/{_app,index.html,favicon.ico}`), so the Temporal CLI can depend on it as a plain Go module — [ui-server README](https://github.com/temporalio/ui-server/blob/9ba7e3c8b2c2/README.md), [ui-server ui/embed.go](https://github.com/temporalio/ui-server/blob/9ba7e3c8b2c2/ui/embed.go), [ui-server commits](https://github.com/temporalio/ui-server/commits/main)
- **Gitea** gitignores `/public/assets/js`, `/css` and `/modules/public/bindata.*`. With the `bindata` build tag it embeds a generated `bindata.dat` (`//go:generate go run ../../build/generate-bindata.go ../../public bindata.dat`, `//go:embed bindata.dat`). The docs say `bindata` is "Required for production build", use `TAGS="bindata" make build`, and "Previous versions of this document recommended using go get. This is no longer necessary" (git clone instead) — [gitea modules/public/public_bindata.go](https://github.com/go-gitea/gitea/blob/365cb2bd5e49/modules/public/public_bindata.go), [gitea .gitignore](https://github.com/go-gitea/gitea/blob/365cb2bd5e49/.gitignore), [docs.gitea.com install from source](https://docs.gitea.com/installation/install-from-source)
- **Grafana** does not embed its frontend. It serves it from disk (`static_root_path = public`) — [grafana conf/defaults.ini L72](https://github.com/grafana/grafana/blob/main/conf/defaults.ini#L72)
- **NUI** (NATS GUI): `//go:embed all:frontend/dist-app`, with `frontend/.gitignore` containing `dist-app/*` and `!dist-app/.gitkeep`. Only a placeholder is committed, and its CI does `mkdir frontend/dist-app && touch frontend/dist-app/sample.txt # required for go build to embed it` — [nui main.go L23-L24](https://github.com/nats-nui/nui/blob/71d1487c47cc/main.go#L23-L24), [nui frontend/.gitignore](https://github.com/nats-nui/nui/blob/71d1487c47cc/frontend/.gitignore), [nui build-and-test.yml](https://github.com/nats-nui/nui/blob/71d1487c47cc/.github/workflows/build-and-test.yml)

### Inferences
- **Local run (CGO)**: `CGO_ENABLED=0 go build github.com/zalando/go-keyring@v0.2.8` succeeded for linux, darwin and windows on both amd64 and arm64. Its darwin dependency set is only `internal/shellescape`. nats-server, nats.go, jsm.go and age are all pure Go, so nothing in the planned stack forces cgo. Only native keychain linking (for example `keybase/go-keychain`) or SQLite via `mattn/go-sqlite3` would.
- **`go install` decision.** Three options exist:
  1. **Commit `web/dist` at release time** (PocketBase model). The release workflow builds the frontend, commits `dist` on the release commit, then tags it. `go install github.com/<you>/nats-ui@latest` works fully, and `gomod.proxy: true` becomes possible. Cost: built files in git history (diff noise, repo growth). Mitigation: commit dist only on release commits from CI, and mark it `linguist-generated`.
  2. **Placeholder only** (NUI model). Commit `web/dist/.gitkeep` plus a tiny `index.html` saying "this build has no UI; download a release or run `make build`". `go install` builds, but serves no UI. This is honest, but it breaks the "single binary from `go install`" promise in ADR-0001.
  3. **Mirror module** (Temporal model). Overkill for one repo.
  For nats-ui, where ADR-0001 promises a working `go install`, option 1 is the only one that keeps that promise. In all cases, use `//go:embed all:dist` and keep a committed `.gitkeep`, so a fresh clone compiles before `npm run build`. The embed rules require at least one file, and `all:` is needed to include dot-files.
- Module zips are built from what is committed at the tag, so anything `before.hooks` generates is in GoReleaser builds but **not** in `go install` builds. If dist is not committed, do not enable `gomod.proxy`. Under proxy mode GoReleaser builds from the module zip, which would also lack the UI.
- Suggested `.goreleaser.yaml` (OSS v2):
```yaml
version: 2
project_name: nats-ui
before:
  hooks:
    - npm --prefix web ci
    - npm --prefix web run build          # writes web/dist, embedded by web/embed.go
    - go mod tidy
builds:
  - id: nats-ui
    main: ./cmd/nats-ui
    binary: nats-ui
    env: [CGO_ENABLED=0]
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
    flags: [-trimpath]
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.Commit}} -X main.date={{.CommitDate}}
    mod_timestamp: "{{ .CommitTimestamp }}"
archives:
  - formats: [tar.gz]
    format_overrides: [{ goos: windows, formats: [zip] }]
    name_template: "{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}"
checksum:
  name_template: checksums.txt          # natscli uses SHA256SUMS
sboms:
  - artifacts: archive                  # syft must be on PATH
signs:
  - cmd: cosign
    signature: "${artifact}.sigstore.json"
    args: ["sign-blob", "--bundle=${signature}", "${artifact}", "--yes"]
    artifacts: checksum
notarize:
  macos:
    - enabled: '{{ isEnvSet "MACOS_SIGN_P12" }}'
      sign: { certificate: "{{.Env.MACOS_SIGN_P12}}", password: "{{.Env.MACOS_SIGN_PASSWORD}}" }
      notarize: { issuer_id: "{{.Env.MACOS_NOTARY_ISSUER_ID}}", key_id: "{{.Env.MACOS_NOTARY_KEY_ID}}", key: "{{.Env.MACOS_NOTARY_KEY}}" }
release:
  draft: true
```
- Suggested workflow (`.github/workflows/release.yml`):
```yaml
on: { push: { tags: ['v*.*.*'] } }
permissions: { contents: write, id-token: write, attestations: write }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7          # pin by SHA as natscli does
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v7
        with: { go-version-file: go.mod }
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: go test ./... && npm --prefix web ci && npm --prefix web test -- --run
      - uses: sigstore/cosign-installer@v4
      - uses: anchore/sbom-action/download-syft@v0
      - uses: goreleaser/goreleaser-action@v7
        with: { version: "~> v2", args: release --clean }
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MACOS_SIGN_P12: ${{ secrets.MACOS_SIGN_P12 }}   # optional; gate skips when unset
      - uses: actions/attest@v4                          # optional SLSA provenance
        with: { subject-checksums: dist/checksums.txt }  # or subject-path: 'dist/*.tar.gz'
```
  (The `subject-checksums` input is not on the GitHub Docs page I read. Use `subject-path` if unsure.) A separate PR workflow should run `go test`, `vitest`, `tsc --noEmit` and Playwright (`npx playwright install --with-deps chromium`).
- macOS: without notarization, a binary downloaded through a browser gets the quarantine attribute, and Gatekeeper blocks it on first run. `curl` / `go install` / Homebrew-tap installs usually avoid this. If the $99/yr Apple account is not wanted at first, document `xattr -d com.apple.quarantine nats-ui` and turn on the `notarize` block later. It is gated on a secret, so the config can ship now. (The Gatekeeper behaviour is general knowledge and was not re-cited this session.)
- Windows: binaries are unsigned unless an Authenticode certificate is bought, so SmartScreen may warn. GoReleaser OSS has no Windows signing beyond generic `signs`/`binary_signs` with a custom `cmd` (not researched in depth).

### Gaps
- It is unclear which `before.hooks` features are Pro-only on the current docs page. Simple string hooks are used in GoReleaser's own OSS config, so they work in OSS.
- No Caddy plugin with an embedded UI was examined in time. Caddy plugins are compiled with xcaddy from module source, so the same commit-dist constraint applies (inference, not verified).
- The `actions/attest` `subject-checksums` input was not confirmed on the docs page fetched.
- Gatekeeper behaviour for quarantined unsigned CLI binaries on macOS 26 was not re-verified against Apple docs.

## Q5. Version embedding (ldflags vs debug.ReadBuildInfo) and `--version`

### Takeaway
Do both. GoReleaser injects `main.version/commit/date` via `-X`. When those are empty (a `go install` or plain `go build` binary), fall back to `runtime/debug.ReadBuildInfo()`. Since Go 1.24, `go build` stamps the main module version from VCS tags, and `go install …@vX.Y.Z` records the module version.

### Cited Findings
- GoReleaser default ldflags: `-s -w -X main.version={{.Version}} -X main.commit={{.Commit}} -X main.date={{.Date}} -X main.builtBy=goreleaser` — [goreleaser.com/customization/builds/go](https://goreleaser.com/customization/builds/go/)
- Go 1.24: "The go build command now sets the main module's version in the compiled binary based on the version control system tag and/or commit. A +dirty suffix will be appended if there are uncommitted changes. Use the -buildvcs=false flag to omit version control information" — [go.dev/doc/go1.24](https://go.dev/doc/go1.24)
- `-buildvcs` default "auto" stamps VCS info when the main package, main module and current directory are in the same repository — [cmd/go docs](https://pkg.go.dev/cmd/go)
- With `gomod.proxy`, "VCS Info will not be embedded in the binary" — [goreleaser verifiable builds](https://goreleaser.com/customization/verifiable_builds/)
- natscli's Homebrew formula tests `system "#{bin}/nats --version"`, and nats-server injects `serverVersion={{.Tag}}` and `gitCommit={{.ShortCommit}}` via `-X` — [natscli .goreleaser.yml](https://github.com/nats-io/natscli/blob/e62a4c123040/.goreleaser.yml), [nats-server .goreleaser.yml L19-L20](https://github.com/nats-io/nats-server/blob/v2.15.2/.goreleaser.yml#L19-L20)

### Inferences
```go
// cmd/nats-ui/version.go
var (version, commit, date = "", "", "") // set by -ldflags -X

func versionInfo() (v, c, d string) {
	v, c, d = version, commit, date
	if bi, ok := debug.ReadBuildInfo(); ok {
		if v == "" && bi.Main.Version != "" && bi.Main.Version != "(devel)" {
			v = bi.Main.Version                 // go install …@v1.2.3, or go build in a tagged checkout (Go ≥1.24)
		}
		for _, s := range bi.Settings {
			switch s.Key {
			case "vcs.revision": if c == "" { c = s.Value }
			case "vcs.time":     if d == "" { d = s.Value }
			case "vcs.modified": if s.Value == "true" && !strings.HasSuffix(v, "+dirty") { v += "+dirty" }
			}
		}
	}
	if v == "" { v = "dev" }
	return
}
// `nats-ui --version` → "nats-ui 1.2.3 (abc1234, 2026-10-31T10:00:00Z) go1.27.3 linux/arm64"
```
- Also report the embedded UI build. The frontend can write `dist/build.json` (git SHA from Vite `define`) so `--version` and a `/api/version` endpoint can show a mismatch, for example a `go install` binary with stale committed dist, or a placeholder UI ("ui: none").
- Use `{{.CommitDate}}` rather than `{{.Date}}` together with `mod_timestamp: {{.CommitTimestamp}}`, so the binaries are reproducible.

### Gaps
- `runtime/debug.BuildInfo` docs were not fetched this session. The `(devel)` sentinel and the `vcs.*` setting keys are from the Go toolchain's documented behaviour, as linked from the Go 1.24 notes, but were not re-read.
