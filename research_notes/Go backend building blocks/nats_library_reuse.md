# Reusing natscli, jsm.go and nats.go in the nats-ui Go backend

Versions examined (October 2026). Every repository was cloned at its tag and read locally, and the Go module cache was used to cross-check:
- jsm.go **v0.5.1** (commit 837e6ec, released 2026-10-26) — https://github.com/nats-io/jsm.go/tree/v0.5.1
- natscli **v0.5.1** (commit 4fcbcbc, released 2026-10-26; its go.mod pins jsm.go v0.5.1, nats.go v1.55.0 and nats-server v2.15.2) — https://github.com/nats-io/natscli/tree/v0.5.1
- nats.go **v1.55.0** (commit 6068694, released 2026-10-23) — https://github.com/nats-io/nats.go/tree/v1.55.0
- nats-server **v2.15.2** (commit 5a815f1) — https://github.com/nats-io/nats-server/tree/v2.15.2
- synadia-io/orbit.go **jetstreamext/v0.3.2** (commit 52b976d, 2026-07-27). natscli uses it for Direct Get batches — https://github.com/synadia-io/orbit.go/tree/jetstreamext/v0.3.2
- NATS ADR-31 (Direct Get) at commit dc0b1c7 — https://github.com/nats-io/nats-architecture-and-design/blob/dc0b1c7200f0d716fdee9de1428759594538ed7d/adr/ADR-31.md

Measured locally: I built stripped binaries (`-trimpath -ldflags='-s -w'`) with Go 1.27.3 on linux/amd64. The results appear in the system-account section.

---

## 1. natscontext: loading, listing, selecting and saving contexts the way natscli does, with a custom Vault resolver

### Takeaway
In jsm.go v0.5.x, `natscontext` was rewritten around a `Registry` that combines three parts: a `Backend` (storage), a `Selector` (which Context is active) and a map of `CredentialResolver`s keyed by URI scheme. natscli builds that same Registry from `NewDefaultFileBackend()`, `WithDefaultResolvers()` and `WithLocalSelector()`. nats-ui can do the same, with `NewFileBackendAt(appDir)` for its own directory and a custom resolver for the Vault scheme. `Context.NATSOptions()` then turns a loaded Context into `[]nats.Option`.

### Cited Findings

**The architecture and its public API (v0.5.1)**
- The package "has two orthogonal abstractions": a `Backend` that stores context payloads as opaque bytes, and a `CredentialResolver` that resolves secrets referenced by URI. A `Registry` combines one Backend, an optional Selector and one or more resolvers. The package-level helpers (`KnownContexts`, `SelectContext`, `New`, `Connect`) delegate to a default Registry built lazily from `NewDefaultFileBackend` and the stock resolvers. — [BACKENDS.md §Overview L5-L14](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L5-L14)
- The jsm.go v0.5.0 release notes describe this as "Pluggable NATS Context System … rewritten around the concept of pluggable backends". The first two backends are a backward-compatible file backend and one that reaches contexts over NATS request-reply. — [jsm.go v0.5.0 release](https://github.com/nats-io/jsm.go/releases/tag/v0.5.0)
- `type Backend interface { Load(ctx, name) ([]byte, error); Save(ctx, name, data) error; Delete(ctx, name) error; List(ctx) ([]string, error) }` and `type Selector interface { Selected(ctx) (string, error); SetSelected(ctx, name) (previous string, err error) }`. — [backend.go L43-L65](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/backend.go#L43-L65)
- Error sentinels are `ErrNotFound`, `ErrAlreadyExists`, `ErrInvalidName`, `ErrActiveContext`, `ErrNoneSelected`, `ErrReadOnly` and `ErrConflict`. `ValidateName` rejects only names that are empty, contain `..`, or contain `/` or `\`. — [backend.go L24-L33, L83-L94](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/backend.go#L24-L94)
- Registry methods: `NewRegistry(b Backend, opts ...RegistryOption) *Registry`, `Load(ctx, name, opts ...Option) (*Context, error)` (an empty name loads the selected Context), `Save(ctx, c, name)`, `Delete`, `List`, `Known`, `Selected`, `Select(ctx, name) (previous, error)`, `Unselect`, `Previous`. — [registry.go L45-L400](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/registry.go#L45-L400)
- `NewRegistry` uses the Backend as the Selector when the Backend implements `Selector`. `WithSelector(s)`, `WithLocalSelector()` and `WithoutSelection()` override that. If no resolver option is given, `WithDefaultResolvers()` is applied automatically. — [registry.go L45-L112](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/registry.go#L45-L112)
- `Registry.Save` runs `migrateNSCLookup`, then `c.Validate()`, optionally embeds file credentials (`WithEmbedding`), writes the result with `json.MarshalIndent`, and passes it to `backend.Save`. — [registry.go L178-L231](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/registry.go#L178-L231)
- Other constructors: `New(name, load bool, opts...)`, `NewFromFile(filename, opts...)` (uses a `SingleFileBackend`), `NewFromBytes(data, opts...)`, and `NewFromBytesRaw(data, opts...)`. The Raw variant skips `~`/`$VAR` expansion, nsc lookup and the `nats.DefaultURL` fallback, and is "intended for editing tools that need a faithful roundtrip". — [context.go L192-L255](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L192-L255)
- `WithoutExpansion()` is the Registry-level equivalent: Load returns the on-disk payload unchanged, which is "useful for tools that load a context, present its raw fields for editing, and write it back unchanged". — [credentials.go L56-L68](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L56-L68)
- `WithEmbedding()` makes Save read file-backed `Creds`, `NKey`, `UserJwt` and `UserSeed` and rewrite them as `data:;base64,<contents>` URIs. `Context.SaveEmbedded` and `Context.Embed` do the same. — [credentials.go L70-L91](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L70-L91); [context.go L801-L829](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L801-L829)
- The JSON fields of a stored context are `description, url, socks_proxy, token, user, password, creds, nkey, cert, key, ca, nsc, jetstream_domain, jetstream_api_prefix, jetstream_event_prefix, inbox_prefix, user_jwt, user_seed, color_scheme, tls_first, windows_cert_store, …`. — [context.go L62-L95](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L62-L95)
- `*Context` implements `String`/`GoString` with redaction, so `%v` and `%+v` do not print secrets. — [BACKENDS.md §Secret hygiene L314-L323](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L314-L323)

**Storing contexts somewhere other than ~/.config/nats/context**
- `NewDefaultFileBackend()` is rooted at `$XDG_CONFIG_HOME`, falling back to `$HOME/.config`. `NewFileBackendAt(dir)` "keeps its context files under dir/nats/context/". — [backend_file.go L46-L93](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/backend_file.go#L46-L93)
- The file layout is `<root>/nats/context/<name>.json`, and `Path(name)` returns that path. The FileBackend holds its own `FileSelector` on the same root, so selection lives in `<root>/nats/context.txt` and `<root>/nats/previous-context.txt`. — [backend_file.go L37-L45, L95-L103](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/backend_file.go#L37-L103); [backend_selector.go L60-L74](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/backend_selector.go#L60-L74)
- `NewFileSelectorAt(dir)` stores selection under `dir/nats/`. `NewDefaultFileSelector()` returns an error instead of failing silently when neither XDG nor HOME resolves. `WithLocalSelector()` panics in that case. — [backend_selector.go L46-L66](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/backend_selector.go#L46-L66); [registry.go L96-L112](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/registry.go#L96-L112)
- `MemoryBackend` (a mutex-protected map) and `SingleFileBackend` are also shipped. The contract test suite `natscontext/backendtest.RunBackendContract` is meant for third-party backends. — [BACKENDS.md §Shipped implementations, §Contract tests](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L16-L28)
- FileBackend writes are atomic: it writes a temp file, renames it, then fsyncs the parent directory. — [BACKENDS.md §Atomicity L98-L100](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L98-L100)
- The documented pattern for encryption at rest is a wrapper Backend that seals on Save and opens on Load. — [BACKENDS.md §Composing backends L178-L210](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L178-L210)

**What natscli itself does**
- `loadContext` builds `registryOpts := {natscontext.WithDefaultResolvers(), natscontext.WithLocalSelector()}` and `natscontext.NewRegistry(natscontext.NewDefaultFileBackend(), registryOpts...)`. For a `--context` value that is an existing `.json` path, it uses `NewSingleFileBackend(path)` instead. CLI flags are applied as `natscontext.Option` overrides (`WithServerURL`, `WithCreds`, …) through `registry.Load(ctx, name, ctxOpts...)`. — [natscli cli/util.go L519-L591](https://github.com/nats-io/natscli/blob/v0.5.1/cli/util.go#L519-L591)
- `nats context` caches a Registry built the same way. — [natscli cli/context_command.go L117-L138](https://github.com/nats-io/natscli/blob/v0.5.1/cli/context_command.go#L117-L138)
- natscli adds its own connection options on top of `Config.NATSOptions()`: `nats.Name("NATS CLI Version …")`, `MaxReconnects(-1)`, `IgnoreAuthErrorAbort()`, `NoCallbacksAfterClientClose()`, a custom backoff `CustomReconnectDelay`, and logging handlers. — [natscli cli/util.go L220-L285](https://github.com/nats-io/natscli/blob/v0.5.1/cli/util.go#L220-L285)
- It uses the Context's JetStream domain and prefix like this: `jetstream.NewWithDomain(nc, cfg.JSDomain())` / `NewWithAPIPrefix(...)` / `New(...)` for nats.go, and `Config.JSMOptions()` plus `jsm.WithAPIValidation`, `WithTimeout` and `WithTrace` for jsm. — [natscli cli/util.go L406-L515](https://github.com/nats-io/natscli/blob/v0.5.1/cli/util.go#L406-L515)

**How NATSOptions / Connect build nats.Option values**
- `Context.Connect(opts...)` calls `NATSOptions(opts...)`, then `nats.Connect(c.ServerURL(), nopts...)`. The URL is not part of the option slice. The package-level `Connect(name, opts...)` does `New(name, true)` then `Connect`. — [context.go L316-L392](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L316-L392)
- `JSMOptions()` returns `jsm.WithAPIPrefix`, `jsm.WithEventPrefix` and `jsm.WithDomain` taken from the Context. — [context.go L394-L403](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L394-L403)
- `NATSOptions` picks exactly one auth mode, in this order: (1) `user` set → `nats.UserInfo(user, resolveLiteral(password))`; (2) `creds` → `buildCredsOption`; (3) `nkey` → `buildNkeyOption`; (4) `user_jwt`+`user_seed` → `nats.UserJWTAndSeed`; (5) `user_jwt` only → `nats.UserJWT` with a no-op signer. It then adds, independently: `token` → `nats.Token(resolveLiteral(...))`; cert+key → `nats.ClientCert` (file paths only); CA → `nats.RootCAs`; socks → `nats.SetCustomDialer(SocksDialer)`; inbox prefix → `nats.CustomInboxPrefix`; `tls_first` → `nats.TLSHandshakeFirst()`; Windows cert-store options; and finally the caller's opts. — [context.go L405-L510](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L405-L510)
- `NATSOptions` resolves secrets with `ctx := context.Background()` and has no context parameter, so resolver calls cannot be cancelled by the caller. — [context.go L406](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L406)
- Creds with `file://` or a bare path go straight to `nats.UserCredentials(path)`, which reads the file lazily at dial time. Any other scheme is resolved eagerly to bytes, parsed with `nkeys.ParseDecoratedJWT` and `ParseDecoratedNKey`, and wrapped in `nats.UserJWT(userCB, sigCB)`. The resolved bytes are wiped afterwards. — [context.go L526-L563](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L526-L563); [BACKENDS.md L351](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L351)
- NKey with a file path uses `nats.NkeyOptionFromSeed(path)`. Other schemes become `nats.Nkey(pub, sigCB)` using the resolved seed. — [context.go L565-L598](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L565-L598)
- Field semantics: for `Creds` and `NKey`, a bare value is treated as a `file://` path. For `UserJwt`, `UserSeed`, `Token` and `Password`, a bare value is the literal value. `Cert`, `Key` and `CA` are file paths only, and non-file schemes for them are rejected "until nats.go exposes in-memory TLS equivalents". — [BACKENDS.md §Field semantics L287-L298](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L287-L298)
- Unknown schemes behave differently by field. `resolveLiteral` returns the reference unchanged as a literal when no resolver matches its scheme, which affects password, token, JWT and seed. `buildCredsOption` and `buildNkeyOption` instead return the error `creds: no resolver registered for scheme %q`. — [credentials.go L156-L176](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L156-L176); [context.go L534, L573](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L526-L598)

**Resolver API**
- `type CredentialResolver interface { Schemes() []string; Resolve(ctx context.Context, ref string) ([]byte, error) }`. Returning `""` from `Schemes` makes the resolver the fallback for bare values. Resolve receives the full unmodified URI. Implementations must not log the resolved bytes, should not include them in errors, and should return a fresh slice because the caller wipes it. — [credentials.go L24-L38](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L24-L38); [BACKENDS.md §Responsibilities L278-L285](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L278-L285)
- `WithCredentialResolver(r)` registers `r` for each scheme it advertises. Passing any resolver option suppresses the automatic defaults, so add `WithDefaultResolvers()` to layer a custom resolver on top of them. — [credentials.go L40-L54](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L40-L54); [BACKENDS.md §Registration L300-L312](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/BACKENDS.md#L300-L312)
- `defaultResolvers()` returns `fileResolver`, `opResolver` (shells out to `op read`), `nscResolver` (shells out to `nsc generate profile`), `envResolver` (`env://NAME`) and `dataResolver` (`data:;base64,`). The doc comment on `WithDefaultResolvers` lists only "file://, op://, nsc://". That comment is stale; the code and the v0.5.0 release notes include env and data too. — [credentials.go L93-L117](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L93-L117); [jsm.go v0.5.0 release](https://github.com/nats-io/jsm.go/releases/tag/v0.5.0)
- Scheme detection uses `net/url` with a minimum scheme length of two characters, so `C:\…` is not treated as a scheme. Schemes match case-insensitively. — [credentials.go parseScheme L125-L153](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/credentials.go#L125-L153)
- The resolver set is captured on the `Context` by `Registry.Load`. A Context built from options alone (`New(name,false,…)`, `NewFromBytes`) falls back to the package-default resolvers, which do not include custom ones. — [context.go activeResolvers L513-L524](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L513-L524)

**Code sketch: an app Registry with a Vault resolver (follows natscli's composition)**
```go
import "github.com/nats-io/jsm.go/natscontext"

type vaultResolver struct{ v Vault } // our keyring/age store

func (vaultResolver) Schemes() []string { return []string{"keyring"} } // e.g. keyring://<ctx>/<field>
func (r vaultResolver) Resolve(ctx context.Context, ref string) ([]byte, error) {
    id := ref[len("keyring://"):]          // scheme is matched case-insensitively upstream
    b, err := r.v.Get(ctx, id)             // MUST NOT block on a locked Vault: NATSOptions passes context.Background()
    if err != nil { return nil, fmt.Errorf("vault lookup %q failed", id) } // never echo secret bytes
    return bytes.Clone(b), nil             // caller wipes the slice
}

appReg := natscontext.NewRegistry(
    natscontext.NewFileBackendAt(appCfgDir),          // -> appCfgDir/nats/context/*.json, selection in appCfgDir/nats/context.txt
    natscontext.WithDefaultResolvers(),               // keep file/op/nsc/env/data
    natscontext.WithCredentialResolver(vaultResolver{v}),
)
cliReg := natscontext.NewRegistry(natscontext.NewDefaultFileBackend(), // read ~/.config/nats/context too
    natscontext.WithDefaultResolvers(), natscontext.WithoutSelection()) // don't touch natscli's selection

c, err := appReg.Load(ctx, name)                     // or WithoutExpansion()/NewFromBytesRaw for the editor
opts, err := c.NATSOptions(nats.Name("nats-ui"), nats.MaxReconnects(-1))
nc, err := nats.Connect(c.ServerURL(), opts...)
jsmOpts, _ := c.JSMOptions(jsm.WithTimeout(5*time.Second))
mgr, _ := jsm.New(nc, jsmOpts...)
```

### Inferences
- The path layout matters for ADR-0002. `NewFileBackendAt(dir)` always appends `nats/context`, so the app's own directory is laid out as `<appCfgDir>/nats/context/`. There is no option to drop the `nats/` segment. A completely custom layout needs a custom Backend, which is about 40 lines plus the contract test.
- Selection is a separate concern from storage. Showing natscli's contexts together with the app's own needs two Registries, and the app must decide which Registry's Selector holds the "exactly one active" Context. Using `WithoutSelection()` on the natscli Registry avoids changing `~/.config/nats/context.txt`. That fits ADR-0002's rule of never editing CLI files without asking.
- Never use `WithEmbedding`, `SaveEmbedded` or `Embed`. They write `data:;base64,` Plaintext secrets, which ADR-0002 forbids.
- The ADR-0002 statement that natscli "passes unknown schemes through as the literal secret" is accurate for `password`, `token`, `user_jwt` and `user_seed`. For `creds` and `nkey`, natscli fails with "no resolver registered for scheme". Either way, a `keyring://` Context in the shared directory breaks natscli, so ADR-0002's decision stands.
- `NATSOptions` resolves non-file secrets eagerly and keeps them in closures for the life of the connection. A locked Vault therefore has to be unlocked before connecting, and the resolver should fail fast with a typed error the API can map to "Vault locked".
- For TLS client keys, `requireFilePath` means a key stored in the Vault would have to be written to a temp file, which ADR-0002 counts as a Plaintext secret. The alternative is to bypass natscontext for TLS and build `nats.Secure(&tls.Config{Certificates: …})` directly. natscontext offers no in-memory TLS path today.

### Gaps
- The `svcbackend` (NATS request-reply backend) and `natscontextkv` packages are referenced in BACKENDS.md but were not examined. The app does not need them.
- orbit.go also ships a separate `natscontext` module. I did not compare it with jsm.go's. natscli uses jsm.go's, and that is what ADR-0001 refers to.

---

## 2. jsm.go vs nats.go `jetstream`: which to use for which operation; stability and maintenance; what natscli uses

### Takeaway
Use both, as natscli does. jsm.go `Manager` and `Stream` cover stream and consumer administration with server-mirroring `api.*` structs: CRUD, info, purge, message delete, contained subjects, and Direct Get batches including `max_bytes` and `start_time`. nats.go `jetstream` covers KV, Object Store and ordered consumers, because jsm.go has no KV or Object Store API at all. nats.go is the stable, semver'd, backward-compatible API. jsm.go is v0.x, explicitly aimed at tooling, and made a breaking change in v0.5.0.

### Cited Findings

**What natscli uses (v0.5.1)**
- I counted references per command file. `stream_command.go` has 68 jsm references and 0 to `jetstream`. `consumer_command.go` has 62 and 0. `kv_command.go` uses `jetstream` (36 references, through `prepareJSHelper`), as does `object_command.go` (17). `sub_command.go` uses `jetstream` (36) together with orbit `jetstreamext`. This is my own count over [cli/](https://github.com/nats-io/natscli/tree/v0.5.1/cli). Examples: `c.mgr.LoadStream(stream)` [stream_command.go L872](https://github.com/nats-io/natscli/blob/v0.5.1/cli/stream_command.go#L872); `c.mgr.StreamContainedSubjects(c.stream, c.filterSubject)` [L734](https://github.com/nats-io/natscli/blob/v0.5.1/cli/stream_command.go#L734); `stream.DeleteMessageRequest(api.JSApiMsgDeleteRequest{Seq: …})` [L3447](https://github.com/nats-io/natscli/blob/v0.5.1/cli/stream_command.go#L3447); `stream.ReadMessage(seq)` [L3479](https://github.com/nats-io/natscli/blob/v0.5.1/cli/stream_command.go#L3479).
- natscli has two connection helpers: `prepareHelper` returns `(*nats.Conn, *jsm.Manager)` and `prepareJSHelper` returns `(*nats.Conn, jetstream.JetStream)`, and both share one connection. — [cli/util.go L406-L515](https://github.com/nats-io/natscli/blob/v0.5.1/cli/util.go#L406-L515)
- `nats sub --stream` paging uses `jetstreamext.GetBatch(ctx, js, stream, batchSize, jetstreamext.GetBatchStartTime(start))` or `GetBatchSeq(seq)`, and `GetLastMsgsFor(...)` for last-per-subject. — [cli/sub_command.go L948-L969](https://github.com/nats-io/natscli/blob/v0.5.1/cli/sub_command.go#L948-L969)

**jsm.go stream and consumer API (v0.5.1)**
- `jsm.New(nc, opts...)`. Streams: `NewStreamFromDefault(name, api.StreamConfig, …)`, `LoadStream(name)`, `LoadOrNewStream…`, `Streams(filter)` and `EachStream(filter, cb)`, which also return `missing` and `offline` lists. Also `StreamNames`, `DeleteStream`, `DeleteStreamMessage(stream, seq, noErase)` and `StreamContainedSubjects(stream, filter...)`. — [manager.go L49-L688](https://github.com/nats-io/jsm.go/blob/v0.5.1/manager.go#L49-L688); [streams.go L75-L194](https://github.com/nats-io/jsm.go/blob/v0.5.1/streams.go#L75-L194)
- `Stream.Information(req ...api.JSApiStreamInfoRequest)` sends a single request, `loadStreamInfo`, and does not page. `api.JSApiStreamInfoRequest{JSApiIterableRequest; DeletedDetails bool; SubjectsFilter string}`. — [streams.go L711-L732, L245-L254](https://github.com/nats-io/jsm.go/blob/v0.5.1/streams.go#L711-L732); [api/streams.go L122-L126](https://github.com/nats-io/jsm.go/blob/v0.5.1/api/streams.go#L122-L126)
- `Manager.StreamContainedSubjects` does page: it uses `iterableRequest` with `SubjectsFilter` (default `>`) and merges `State.Subjects` from all pages into a `map[string]uint64`. — [manager.go L650-L688](https://github.com/nats-io/jsm.go/blob/v0.5.1/manager.go#L650-L688)
- Purge: `Stream.Purge(*api.JSApiStreamPurgeRequest)` and `PurgeExt(req)`, which returns `*api.JSApiStreamPurgeResponse` (the purged count). Message delete: `DeleteMessageRequest(api.JSApiMsgDeleteRequest{Seq, NoErase})`. `DeleteMessage` and `FastDeleteMessage` are deprecated. Read: `ReadMessage(seq)` and `ReadLastMessageForSubject(subj)`, both returning `*api.StoredMsg` through `$JS.API.STREAM.MSG.GET`. — [streams.go L810-L887](https://github.com/nats-io/jsm.go/blob/v0.5.1/streams.go#L810-L887)
- `Stream.DirectGet(ctx, req api.JSApiMsgGetRequest, handler func(*nats.Msg)) (numPending, lastSeq, upToSeq uint64, err error)`. It errors unless the stream has `AllowDirect`. It publishes to `$JS.API.DIRECT.GET.<stream>`, handles statuses `204` (EOB, reading `Nats-Last-Sequence` and `Nats-UpTo-Sequence`), `404`, `408` and `413`, and treats a missing `Nats-Num-Pending` as "server does not support batch requests". Its idle timeout is the Manager timeout, reset on every message. — [streams.go L951-L1052](https://github.com/nats-io/jsm.go/blob/v0.5.1/streams.go#L951-L1052)
- `api.JSApiMsgGetRequest` fields: `Seq`, `LastFor (last_by_subj)`, `NextFor (next_by_subj)`, `Batch`, `MaxBytes`, `StartTime *time.Time`, `MultiLastFor (multi_last)`, `UpToSeq`, `UpToTime`, `NoHeaders (no_hdr)`. These match nats-server v2.15.2's `JSApiMsgGetRequest`. — [jsm api/streams.go L254-L276](https://github.com/nats-io/jsm.go/blob/v0.5.1/api/streams.go#L254-L276); [server jetstream_api.go L825-L847](https://github.com/nats-io/nats-server/blob/v2.15.2/server/jetstream_api.go#L825-L847)
- jsm.go v0.5.1 lists "Correctness fix for direct batch". v0.5.0 lists "Paged messages could be cross-delivered into unrelated requests". Both are version-specific reasons to require at least v0.5.1. — [v0.5.1 release](https://github.com/nats-io/jsm.go/releases/tag/v0.5.1); [v0.5.0 release](https://github.com/nats-io/jsm.go/releases/tag/v0.5.0)
- jsm.go has no KV or Object Store client. The only KV-related source in the module is `monitor/kv.go`, a health check. (Seen in the repository tree: [jsm.go v0.5.1](https://github.com/nats-io/jsm.go/tree/v0.5.1).) natscli's `kv` and `object` commands use nats.go `jetstream`, as noted above.

**nats.go jetstream API (v1.55.0)**
- The `Stream` interface is at [stream.go L33](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/stream.go#L33). `Info(ctx, opts...)` with `WithSubjectFilter(subj)` and `WithDeletedDetails(bool)` pages automatically through `offset` until `Total` is reached. — [stream.go L437-L509](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/stream.go#L437-L509); [jetstream_options.go L604-L625](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/jetstream_options.go#L604-L625)
- Purge: `Purge(ctx, WithPurgeSubject, WithPurgeSequence, WithPurgeKeep)`. Delete: `DeleteMsg(ctx, seq)` and `SecureDeleteMsg(ctx, seq)`. — [jetstream_options.go L94-L127](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/jetstream_options.go#L94-L127); [stream.go L517-L547, L693-L724](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/stream.go#L693-L724)
- `GetMsg(ctx, seq, WithGetMsgSubject)` and `GetLastMsgForSubject` silently switch to Direct Get when the cached stream info shows `AllowDirect`. The internal request struct has only `Seq`, `LastFor` and `NextFor`, so nats.go has no batch, `max_bytes` or `start_time` Direct Get. — [stream.go L260-L264, L565-L595](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/stream.go#L260-L595)
- The batch Direct Get lives in orbit.go `jetstreamext`: `GetBatch(ctx, js, stream, batch, GetBatchSeq | GetBatchSubject | GetBatchMaxBytes | GetBatchStartTime) (iter.Seq2[*jetstream.RawStreamMsg, error], error)` and `GetLastMsgsFor(ctx, js, stream, subjects, GetLastMsgsUpToSeq | GetLastMsgsUpToTime | GetLastMsgsBatchSize)`. It defaults to `seq=1` when neither seq nor start time is given. — [orbit.go jetstreamext/getbatch.go L31-L211](https://github.com/synadia-io/orbit.go/blob/jetstreamext/v0.3.2/jetstreamext/getbatch.go#L31-L211)
- orbit.go: "these libraries will evolve rapidly and API guarantees are not made until the specific project has a v1.0.0 version". — [orbit.go README](https://github.com/synadia-io/orbit.go/blob/jetstreamext/v0.3.2/README.md)
- KV and Object Store: `KeyValueManager` and `KeyValue` (with `Watch`, `WatchAll`, `ListKeys`, `ListKeysFiltered`, `History`) at [kv.go L35-L195](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L35-L195), and `ObjectStoreManager` and `ObjectStore` at [object.go L40-L104](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/object.go#L40-L104). `ListKeys` uses a watcher with `MetaOnly()`, which subscribes headers-only and so lists keys without payloads. — [kv.go L1343, L1404](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/kv.go#L1343-L1404)

**Stability and maintenance as of October 2026**
- nats.go: "we are committed to maintaining backward compatibility … we follow the standard go compatibility guidelines". Adding struct fields or interface methods is not counted as breaking. It "always supports at least 2 latest minor Go versions". — [nats.go README L375-L386](https://github.com/nats-io/nats.go/blob/v1.55.0/README.md#L375-L386). The `jetstream` package is "the current JetStream API" and replaces the legacy one. — [README L121](https://github.com/nats-io/nats.go/blob/v1.55.0/README.md#L121)
- nats.go v1.55.0 (2026-10-23) is described as "the biggest nats.go release in a long time: 47 changes", with almost 30 bug fixes. Relevant to this app: fixes to ordered consumer `Fetch()`, `Next()` and `FetchBytes()` blocking forever after `ErrOrderedConsumerConcurrentRequests`, and `FetchNoWait()` restarting from the start of the stream (#2211). It also adds `FetchMaxBytes()`. — [nats.go v1.55.0 release](https://github.com/nats-io/nats.go/releases/tag/v1.55.0)
- jsm.go describes itself as "the underlying library for the `nats` CLI, our Terraform provider, GitHub Actions and Kubernetes CRDs … essentially a direct wrapping of the JetStream API … requires deep technical knowledge of the JetStream internals. For typical end users we suggest the nats.go package." — [jsm.go README](https://github.com/nats-io/jsm.go/blob/v0.5.1/README.md)
- jsm.go v0.5.0 had a "Breaking Changes" entry: the schema registry moved to its own `registry` package. jsm.go is pre-1.0. — [v0.5.0 release](https://github.com/nats-io/jsm.go/releases/tag/v0.5.0)
- Maintenance activity: jsm.go v0.5.1 was released 2026-10-26, and natscli `main` already pins a newer jsm.go pseudo-version, `v0.5.2-0.20261029121945-9aa1e6cf510c`. natscli v0.5.1 was released 2026-10-26. — [jsm.go v0.5.1](https://github.com/nats-io/jsm.go/releases/tag/v0.5.1); [natscli main go.mod](https://github.com/nats-io/natscli/blob/main/go.mod); [natscli v0.5.1](https://github.com/nats-io/natscli/releases/tag/v0.5.1)

### Inferences
- Suggested split:
  - **jsm.go:** stream and consumer list, info, create, edit and delete; purge (`PurgeExt` for the count); message delete (`DeleteMessageRequest` with an erase/no-erase choice); subjects (`StreamContainedSubjects`); Direct Get of an opened message and batch Direct Get (`DirectGet` with `MaxBytes` and `StartTime`); cluster operations such as step-down and peer removal.
  - **nats.go `jetstream`:** KV, Object Store, and the headers-only ordered consumer for browsing.
- Share one `*nats.Conn`, as natscli does.
- jsm.go's typed `api.*` structs follow the server's JSON exactly, and `jsm.WithAPIValidation` checks them against JSON schemas. That suits a UI that shows and edits raw configuration. The cost is that each jsm minor release can break callers. Pin it exactly and wrap it behind the app's own domain layer, as ADR-0001 already implies.
- If the app wants to stay on nats.go types throughout, orbit `jetstreamext.GetBatch` covers batch Direct Get. That adds a second pre-1.0 dependency, although natscli already depends on it.
- Require nats.go ≥ v1.55.0, because the ordered-consumer `Fetch` and `FetchNoWait` fixes are on the browsing path.

### Gaps
- I found no formal deprecation notice or support-window statement for jsm.go beyond the README positioning and its v0.x version.
- I did not verify whether `jsm.Stream.DirectGet` correctly routes the JS API prefix or domain for Direct Get subjects. It uses `api.JSDirectMsgGetT` through `s.DirectSubject()`, and I did not trace whether that applies the Manager's prefix.

---

## 3. Creating an ephemeral, ordered, headers_only consumer with a start sequence or start time

### Takeaway
Use nats.go `Stream.OrderedConsumer`. Its configuration has `HeadersOnly`, `DeliverPolicy`, `OptStartSeq`, `OptStartTime`, `FilterSubjects`, `InactiveThreshold` and `NamePrefix`, and it always creates an in-memory, R1, `AckNone` consumer that resets on gaps. It does not delete the server-side consumer on `Stop()`, so to "leave no trace" the backend must call `DeleteConsumer` on `CachedInfo().Name` and should also set a short `InactiveThreshold`. Avoid jsm.go's `StreamPager`, which creates a durable consumer.

### Cited Findings
- `OrderedConsumerConfig{FilterSubjects []string; DeliverPolicy; OptStartSeq uint64; OptStartTime *time.Time; ReplayPolicy; InactiveThreshold time.Duration; HeadersOnly bool; MaxResetAttempts int; Metadata map[string]string; NamePrefix string}`. — [consumer_config.go L283-L340](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/consumer_config.go#L283-L340)
- `Stream.OrderedConsumer(ctx, cfg)` names consumers `<NamePrefix or nuid>_<serial>` and creates them with `CreateOrUpdateConsumer`. Its doc comment says "Ordered consumers are ephemeral in-memory pull consumers and are resilient to deletes and restarts". — [stream.go L383-L410](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/stream.go#L383-L410)
- The generated server config is `AckPolicy: AckNonePolicy`, `InactiveThreshold: 5*time.Minute` (unless overridden), `Replicas: 1`, `MemoryStorage: true`, `HeadersOnly: cfg.HeadersOnly`. On the first creation it honours `DeliverByStartTimePolicy` with `OptStartTime`, or `OptStartSeq`. After a reset it resumes from `cursor.streamSeq+1` using `DeliverByStartSequencePolicy`. — [ordered.go L583-L650](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L583-L650)
- On reset, the client deletes the old consumer asynchronously (`go … js.DeleteConsumer`). `orderedSubscription.Stop()` only stops the pull subscription and does not delete the current consumer. `CachedInfo()` returns the current consumer's info. — [ordered.go L532-L581, L363-L372, L697-L704](https://github.com/nats-io/nats.go/blob/v1.55.0/jetstream/ordered.go#L532-L704)
- Server side: with `headers_only` the server calls `convertToHeadersOnly(pmsg)`, which sends no payload and adds a `Nats-Msg-Size` header. — [server consumer.go L108](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L108), [L5506-L5512](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L5506-L5512), [L5774-L5790](https://github.com/nats-io/nats-server/blob/v2.15.2/server/consumer.go#L5774-L5790)
- natscli's `nats sub --stream` builds a plain (non-ordered) `jetstream.ConsumerConfig{AckPolicy: AckNonePolicy, HeadersOnly: c.headersOnly || c.subjectsOnly, …}` with `OptStartSeq` and `DeliverByStartSequencePolicy`, or `OptStartTime` and `DeliverByStartTimePolicy`. — [cli/sub_command.go L761-L800](https://github.com/nats-io/natscli/blob/v0.5.1/cli/sub_command.go#L761-L800)
- jsm.go's alternative. Consumer options include `jsm.DeliverHeadersOnly()` ("only deliver existing header and the `Nats-Msg-Size` header, no bodies"), `StartAtSequence(n)`, `StartAtTime(t)`, `AcknowledgeNone()`, `InactiveThreshold(d)`, `ConsumerOverrideMemoryStorage()`, `ConsumerOverrideReplicas(1)` and `FilterStreamBySubject(...)`, with pulls through `Consumer.NextMsgRequest(inbox, &api.JSApiConsumerGetNextRequest{Batch, NoWait})`. jsm.go has no ordered-consumer gap or reset logic. — [consumers.go L300-L620, L828-L846](https://github.com/nats-io/jsm.go/blob/v0.5.1/consumers.go#L300-L620)
- jsm.go `StreamPager`, which natscli uses for `nats stream view` ([stream_command.go L1244](https://github.com/nats-io/natscli/blob/v0.5.1/cli/stream_command.go#L1244)), creates `DurableName(fmt.Sprintf("stream_pager_%d%d", pid, nanos))` with `InactiveThreshold(time.Hour)`. It uses Direct Get only for WorkQueue or Interest streams, one message per request, "until there is a batch mode direct request". — [stream_pager.go L76-L182, L259-L290](https://github.com/nats-io/jsm.go/blob/v0.5.1/stream_pager.go#L76-L290)
- v1.55.0 fixed ordered consumers with `StopAfter` hanging or delivering wrong counts (#2167), `Fetch`/`Next`/`FetchBytes` blocking forever and `FetchNoWait` restarting from the start (#2211), and heartbeat timing (#2182). — [nats.go v1.55.0 release](https://github.com/nats-io/nats.go/releases/tag/v1.55.0)

**Code sketch: listing a page of 100 rows, metadata only**
```go
s, err := js.Stream(ctx, stream)
cfg := jetstream.OrderedConsumerConfig{
    FilterSubjects:    filters,                    // optional
    HeadersOnly:       true,                       // server sends headers + Nats-Msg-Size, no payload
    InactiveThreshold: 30 * time.Second,           // server reaps it if we crash
    NamePrefix:        "nats_ui_browse_" + nuid.Next(),
}
if !startTime.IsZero() {
    cfg.DeliverPolicy, cfg.OptStartTime = jetstream.DeliverByStartTimePolicy, &startTime
} else {
    cfg.DeliverPolicy, cfg.OptStartSeq = jetstream.DeliverByStartSequencePolicy, startSeq
}
oc, err := s.OrderedConsumer(ctx, cfg)
defer func() { // "leave no trace": Stop() alone leaves the consumer until InactiveThreshold
    if ci := oc.CachedInfo(); ci != nil {
        dctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        _ = js.DeleteConsumer(dctx, stream, ci.Name); cancel()
    }
}()
batch, err := oc.Fetch(100, jetstream.FetchMaxWait(2*time.Second)) // one Fetch at a time per ordered consumer
for m := range batch.Messages() {
    md, _ := m.Metadata()                        // md.Sequence.Stream, md.Timestamp, md.NumPending
    size := m.Headers().Get("Nats-Msg-Size")     // payload size without payload
    _ = row{Seq: md.Sequence.Stream, Subject: m.Subject(), Time: md.Timestamp, Size: size, Hdrs: m.Headers()}
}
if err := batch.Error(); err != nil { /* … */ }
```

### Inferences
- An ordered consumer guarantees order and handles gaps by recreating itself. That is what a sequence-keyed virtualised table needs, because ADR-0003 says pages are keyed by sequence. Each page jump (a new start sequence or time) should create a fresh ordered consumer, then delete it explicitly.
- `md.NumPending` from the first message gives the remaining count, which can drive the approximate scrollbar.
- Ordered consumers are `AckNone` and in-memory, so they never move another consumer's position. With an explicit delete they satisfy the glossary's definition of **Browsing**. `StreamPager` does not, because it is durable and keeps an hour of inactivity threshold.
- Work-queue streams reject a consumer whose filter overlaps an existing one, so headers-only browsing can fail there. For such streams the fallback is Direct Get (`AllowDirect`), which is also what jsm.go's pager does. I did not test this against v2.15.2.

### Gaps
- I did not verify how nats-server v2.15.2 behaves with an ordered or ephemeral consumer on WorkQueue or Interest retention streams (the overlap rule). It needs a live test.
- `FetchMaxWait` behaviour when fewer than 100 messages remain was not measured, i.e. whether it returns early on end of stream. `FetchNoWait(100)` is the alternative, and it was fixed in v1.55.0.

---

## 4. System-account requests ($SYS.REQ.SERVER.PING.*, STATSZ, KICK, RELOAD): reusable helpers and the cost of importing nats-server

### Takeaway
jsm.go's `serverdata` package is the reusable helper natscli uses. It provides `DoReq`/`DoReqAsync` (scatter-gather with `waitFor` semantics), `CurrentActiveServers` (how many replies to expect) and `Live` (typed `Varz`, `Connz`, `Routez`, `Gatewayz`, `Leafz`, `Subsz`, `Jsz`, `Healthz`, `Accountz`, `Statz`, `Raftz`, …), all returning `nats-server/v2/server` types. Importing `server` for its types costs almost nothing once jsm.go is in, because jsm.go's root package already imports it. Measured: nats.go-only binary 7.1 MB; with jsm.go + natscontext 14.6 MB; adding explicit `server` types + `serverdata` brought it to 14.63 MB, about 74 KB more. A lighter typed client without the server module exists (orbit `natssysclient`), but it has no KICK or RELOAD.

### Cited Findings
- `serverdata.DoReqAsync(ctx, req any, subj string, waitFor int, nc *nats.Conn, timeout time.Duration, log api.Logger, cb func([]byte))` behaves as follows by `waitFor`: `< 0` listens for the full timeout; `== 0` is an adaptive timeout ("after each response, wait a short amount of time for more"); `> 0` stops after that many replies. `DoReq` collects the replies into `[][]byte`. `CurrentActiveServers(ctx, nc, domain, timeout, log)` returns the expected server count. — [serverdata/request.go L19-L26, L164-L200](https://github.com/nats-io/jsm.go/blob/v0.5.1/serverdata/request.go#L19-L200)
- `DoReqAsync` calls `log.Debugf` unconditionally, so pass `api.NewDiscardLogger()` rather than nil. — [serverdata/request.go L42](https://github.com/nats-io/jsm.go/blob/v0.5.1/serverdata/request.go#L26-L50); [api/logger.go L47](https://github.com/nats-io/jsm.go/blob/v0.5.1/api/logger.go#L47)
- `serverdata.NewLive(nc, reqFn RequestFunc, waitFor int)`. Its typed methods include `Varz(server.VarzEventOptions) ([]*server.ServerAPIVarzResponse, error)` → `$SYS.REQ.SERVER.PING.VARZ` and `Connz(server.ConnzEventOptions) ([]*server.ServerAPIConnzResponse, error)` → `…PING.CONNZ`. There are equivalents for ROUTEZ, GATEWAYZ, LEAFZ, SUBSZ, JSZ, HEALTHZ, ACCOUNTZ, IPQUEUESZ, RAFTZ and PROFILEZ, and `Statz` → `$SYS.REQ.SERVER.PING` returning `[]*server.ServerStatsMsg`. — [serverdata/live.go L13-L78](https://github.com/nats-io/jsm.go/blob/v0.5.1/serverdata/live.go#L13-L78)
- The jsm.go v0.5.0 release notes say `serverdata` "can perform various queries against your NATS cluster; these drive the `nats server request *` and `nats server report *` commands", and that it can also read `nats audit` archives. — [v0.5.0 release](https://github.com/nats-io/jsm.go/releases/tag/v0.5.0)
- natscli KICK: `serverdata.DoReq(ctx, &server.KickClientReq{CID: c.cid}, fmt.Sprintf("$SYS.REQ.SERVER.%s.KICK", c.host), 1, nc, …)`. — [cli/server_request_command.go L291-L297](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_request_command.go#L291-L297). natscli RELOAD: `serverdata.DoReq(ctx, nil, fmt.Sprintf("$SYS.REQ.SERVER.%s.RELOAD", c.serverID), 1, …)`, after first fetching VARZ for the confirmation prompt. — [cli/server_config_command.go L50-L83](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_config_command.go#L50-L83)
- natscli's STATSZ watcher (`nats server watch servers`) sends a `$SYS.REQ.SERVER.PING` request to seed its state, subscribes to `$SYS.SERVER.*.STATSZ`, and `json.Unmarshal`s each message into `server.ServerStatsMsg`. That code is in the CLI, not in a reusable package. — [cli/server_watch_srv_command.go L100-L150](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_watch_srv_command.go#L100-L150)
- natscli's `server request` builds its data source as `serverdata.NewLive(nc, func(req, subj, waitFor, nc) { return serverdata.DoReq(ctx, req, subj, waitFor, nc, timeout, logger) }, waitFor)`, with `waitFor` taken from `CurrentActiveServers` when no server is targeted. — [cli/server_request_command.go L212-L236](https://github.com/nats-io/natscli/blob/v0.5.1/cli/server_request_command.go#L212-L236)
- Server-defined subjects and types: `clientKickReqSubj = "$SYS.REQ.SERVER.%s.KICK"`, `serverStatsSubj = "$SYS.SERVER.%s.STATSZ"`, `serverDirectReqSubj = "$SYS.REQ.SERVER.%s.%s"`, `serverPingReqSubj = "$SYS.REQ.SERVER.PING.%s"`, `serverReloadReqSubj = "$SYS.REQ.SERVER.%s.RELOAD"` — [events.go L62-L70](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L62-L70). Types: `ServerStatsMsg` [L150](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L150), `ServerAPIConnzResponse{Server *ServerInfo; Data *Connz; Error *ApiError}` [L2155-L2159](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L2155-L2159), `KickClientReq{CID uint64}` [L3233-L3235](https://github.com/nats-io/nats-server/blob/v2.15.2/server/events.go#L3233-L3235).
- jsm.go's root package imports `github.com/nats-io/nats-server/v2/server`: [manager.go L29](https://github.com/nats-io/jsm.go/blob/v0.5.1/manager.go#L29) uses `server.IsValidLiteralSubject`, and [events.go L7](https://github.com/nats-io/jsm.go/blob/v0.5.1/events.go#L7) uses it too. `natscontext` imports jsm for `JSMOptions`. — [context.go L394](https://github.com/nats-io/jsm.go/blob/v0.5.1/natscontext/context.go#L394-L403)
- jsm.go also has a hand-written server-free type, `api/server/zmonitor.VarzV1`, for VARZ only (with JSON schema `io.nats.server.monitor.v1.varz`). — [api/server/zmonitor/varz.go L22-L25](https://github.com/nats-io/jsm.go/blob/v0.5.1/api/server/zmonitor/varz.go#L22-L25)
- nats-server v2.15.2's direct requirements are antithesis-sdk-go, go-tpm, klauspost/compress, minio/highwayhash, jwt/v2, nats.go, nkeys, nuid, x/crypto, x/sys and x/time. — [nats-server go.mod](https://github.com/nats-io/nats-server/blob/v2.15.2/go.mod). The `server` package has package-level `init()` functions in `const.go` (reads the VCS revision from build info) and `ciphersuites.go` (builds cipher-suite maps). Both are cheap. — [const.go L54](https://github.com/nats-io/nats-server/blob/v2.15.2/server/const.go#L54), [ciphersuites.go L21](https://github.com/nats-io/nats-server/blob/v2.15.2/server/ciphersuites.go#L21)
- **Measured (my own build, Go 1.27.3, linux/amd64, `-trimpath -ldflags='-s -w'`):**
  - (a) nats.go + jetstream (Stream, KV, Object Store calls): **7,098,631 bytes**, 37 dependency packages, 0 from nats-server.
  - (b) (a) + jsm.go `Manager` + `natscontext`: **14,555,840 bytes**, 109 packages, 16 from nats-server, pulled in transitively.
  - (c) (b) + explicit `server.ConnzEventOptions`, `server.KickClientReq` and `serverdata.Live.Connz`: **14,629,888 bytes**, 111 packages.

  Importing `server` directly therefore adds about 74 KB once jsm.go is present. jsm.go itself (with nats-server) roughly doubles the binary compared with nats.go alone. (Local measurement, no URL. The modules used were jsm.go v0.5.1, nats.go v1.55.0 and nats-server v2.15.2.)
- Alternative: orbit.go `natssysclient` (latest tag `natssysclient/v0.2.1`). Its go.mod requires only jwt/v2, nats.go and orbit `natsext`, with no nats-server. Its typed methods are `Varz`/`VarzPing`, `Connz`/`ConnzPing`/`AllConnz` (iterator), `Healthz`, `Jsz`/`AllJsz`, `ServerSubsz` and `ServerStatsz`/`ServerStatszPing`. I found no Kick, Reload, Routez, Leafz, Gatewayz or Accountz in the inspected commit. — [orbit.go natssysclient @52b976d](https://github.com/synadia-io/orbit.go/tree/52b976df6160cace6c81a5c5f43b1284dbabbf93/natssysclient); [go.mod](https://github.com/synadia-io/orbit.go/blob/52b976df6160cace6c81a5c5f43b1284dbabbf93/natssysclient/go.mod)

**Code sketch**
```go
import (
    "github.com/nats-io/jsm.go/api"
    "github.com/nats-io/jsm.go/serverdata"
    "github.com/nats-io/nats-server/v2/server"
)
log := api.NewDiscardLogger()
n, _ := serverdata.CurrentActiveServers(ctx, sysNC, domain, 2*time.Second, log)
live, _ := serverdata.NewLive(sysNC, func(req any, subj string, w int, nc *nats.Conn) ([][]byte, error) {
    return serverdata.DoReq(ctx, req, subj, w, nc, 2*time.Second, log)
}, n)
connz, err := live.Connz(server.ConnzEventOptions{ConnzOptions: server.ConnzOptions{Limit: 1024}})
// KICK / RELOAD: direct by server ID, expect 1 reply
_, err = serverdata.DoReq(ctx, &server.KickClientReq{CID: cid}, fmt.Sprintf("$SYS.REQ.SERVER.%s.KICK", srvID), 1, sysNC, 2*time.Second, log)
_, err = serverdata.DoReq(ctx, nil, fmt.Sprintf("$SYS.REQ.SERVER.%s.RELOAD", srvID), 1, sysNC, 2*time.Second, log)
// STATSZ live feed (no helper upstream): subscribe and decode
sysNC.Subscribe("$SYS.SERVER.*.STATSZ", func(m *nats.Msg) { var s server.ServerStatsMsg; _ = json.Unmarshal(m.Data, &s) })
```

### Inferences
- Since jsm.go is used anyway for streams and contexts, use the `server` types and `serverdata` directly. They are the server's own definitions, so they cannot drift from the wire format, and the size cost is negligible. `natssysclient` only becomes worthwhile if jsm.go is dropped altogether.
- The `server` types mirror the HTTP monitoring JSON (`/varz`, `/connz`). The Monitoring URL fallback in the glossary can decode into the same `server.Varz` and `server.Connz` structs, so one decoder handles both sources.
- The binary will be about 15 MB stripped before the embedded React bundle. That is acceptable for a single-binary distribution under ADR-0001.

### Gaps
- I did not measure compile time, or the size impact on other platforms (darwin, windows).
- I did not verify whether the Go linker's dead-code elimination would shrink (b) further if natscontext were the only jsm.go import. jsm's root package is always linked through natscontext.

---

## 5. natscli's pub templating: where it lives, whether it can be imported, headers, and `nats req`

### Takeaway
The templating is `PubReplyBodyTemplate(body, request string, ctr int) ([]byte, error)` in `github.com/nats-io/natscli/internal/util`. `Publisher.ParseTemplates` wraps it for the body and subject, and `parseStringsToHeader` applies it to header values. Because the package is under `internal/`, the Go toolchain refuses to import it from another module; I confirmed this with a build. To match the CLI exactly, copy the roughly 40-line function, which the Apache-2.0 licence allows with attribution. In the CLI, templates apply to header values always, even with `--no-templates`. `nats req` supports templates exactly as `nats pub` does.

### Cited Findings
- `func PubReplyBodyTemplate(body string, request string, ctr int) ([]byte, error)` uses `text/template` with this FuncMap: `Random` (→ `RandomString(shortest, longest uint)`), `Count`, `Cnt`, `Unix`, `UnixNano`, `TimeStamp` (RFC 3339), `Time` (`time.Kitchen`), `ID` (`nuid.Next()`), and `Request` (only when request ≠ ""). The data struct `pubData{Cnt, Count, Unix, UnixNano, TimeStamp, Time, Request}` has an `ID()` method. `now` is captured once per call. On a parse or execute error it returns the original body together with the error. — [internal/util/headers.go L68-L120](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/headers.go#L68-L122)
- `RandomString` picks a length uniformly in `[shortest, longest]` (swapping them if reversed) from `letterRunes = a-zA-Z0-9`. — [internal/util/random.go L18, L32-L51](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/random.go#L18-L51)
- `func (p *Publisher) ParseTemplates(body, subject string, ctr int) (string, string, error, error)` returns its input unchanged when `!p.templates`. Otherwise it runs `PubReplyBodyTemplate(body, "", ctr)` and `PubReplyBodyTemplate(subject, "", ctr)`. — [internal/util/publisher.go L143-L153](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/publisher.go#L143-L153)
- Headers: `Publisher.PrepareMsg(subj, replyTo, body, hdrs []string, seq)` calls `ParseStringsToMsgHeader`. `parseStringsToHeader` splits each `K:V` on the first `:`, trims both parts, and runs `PubReplyBodyTemplate(value, "", seq)` on the value only. It does not check the templates flag. — [publisher.go L155-L166](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/publisher.go#L155-L166); [headers.go L50-L66](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/headers.go#L50-L66)
- Flag text: `--templates` "Enables template functions in the body and subject (does not affect headers)", default true, in both `pub` and `req`. The help text says "Body and Header values of the messages may use Go templates" and lists Count, TimeStamp, Unix, UnixNano, Time, ID and Random(min,max). — [cli/pub_command.go L70-L88, L113](https://github.com/nats-io/natscli/blob/v0.5.1/cli/pub_command.go#L70-L113); [cli/req_command.go L51, L86](https://github.com/nats-io/natscli/blob/v0.5.1/cli/req_command.go#L51-L86)
- `nats req` calls `pub.ParseTemplates(c.body, c.subject, i)` and then `pub.PrepareMsg(subj, c.replyTo, body, c.hdrs, i)` for `i := 1..count`, so the body, subject and header values are all templated. — [cli/req_command.go L94-L110](https://github.com/nats-io/natscli/blob/v0.5.1/cli/req_command.go#L94-L110)
- `nats reply` additionally passes the incoming request as `{{Request}}`: `iu.PubReplyBodyTemplate(c.body, string(m.Data), i)`. — [cli/reply_command.go L159-L190](https://github.com/nats-io/natscli/blob/v0.5.1/cli/reply_command.go#L159-L190)
- Go's rule is that an import of a path containing `internal` "is disallowed if the importing code is outside the tree rooted at the parent of the 'internal' directory". — [Go 1.4 release notes, Internal packages](https://go.dev/doc/go1.4#internalpackages). Confirmed locally with a module that imports natscli v0.5.1: `use of internal package github.com/nats-io/natscli/internal/util not allowed` (my own build with Go 1.27.3).
- No exported copy of the function exists outside `internal/`. Within natscli it is referenced only from `cli/*.go` files (`reply_command.go`, `object_command.go`, `bench_command.go`) through the `iu` alias. This was a grep over the [v0.5.1 tree](https://github.com/nats-io/natscli/tree/v0.5.1).

### Inferences
- Vendor a copy as, for example, `internal/placeholder/natscli_template.go`. Keep the Apache-2.0 header ("Copyright 2025 The NATS Authors") and add a comment pinning it to natscli v0.5.1 [headers.go L68-L120](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/headers.go#L68-L122). Add a golden test that checks the same function names exist.
- Some CLI behaviours to copy exactly, which matter for Example messages:
  - **Values are fresh per placeholder.** `{{ID}}` in the body and in a header gives two different NUIDs, because each call runs `nuid.Next()`.
  - **Timestamps are computed per call.** `TimeStamp` is computed once per field (`now` per call), not once per message.
  - **Header names are never templated.** Only header values are.
  - **Bad templates fail softly.** A template error leaves the text unchanged, and the CLI only logs it.
- The glossary's **Placeholder** ("subject, headers or payload") matches the CLI only when templates are enabled. With `--templates=false`, the CLI still templates header values. The app can offer the toggle without copying that quirk, but it should document the difference.
- Read-only mode blocks `req` as well as `pub`, per the glossary, so templating has no bearing on that check.

### Gaps
- I did not check whether natscli upstream has an open issue or PR to move the templating into a public package such as `jsm.go` or `orbit.go`. None was found in the code inspected.

---

## 6. Licensing, and whether natscli internal packages can be imported

### Takeaway
natscli, jsm.go, nats.go, nats-server and orbit.go are all Apache License 2.0, and none ships a NOTICE file. That permits importing them and copying small functions, provided the licence and copyright notices are kept. `natscli/internal/...` cannot be imported from another module (the Go toolchain enforces this). The only public natscli packages are the fisk-based `cli` command tree and `options`, which are not suitable as libraries.

### Cited Findings
- natscli LICENSE: Apache License, Version 2.0, January 2004. — [natscli LICENSE](https://github.com/nats-io/natscli/blob/v0.5.1/LICENSE)
- jsm.go LICENSE: Apache License 2.0. — [jsm.go LICENSE](https://github.com/nats-io/jsm.go/blob/v0.5.1/LICENSE)
- nats.go LICENSE: Apache License 2.0. The README says "Unless otherwise noted, the NATS source files are distributed under the Apache Version 2.0 license". — [nats.go LICENSE](https://github.com/nats-io/nats.go/blob/v1.55.0/LICENSE); [README §License](https://github.com/nats-io/nats.go/blob/v1.55.0/README.md)
- nats-server LICENSE: Apache License 2.0. — [nats-server LICENSE](https://github.com/nats-io/nats-server/blob/v2.15.2/LICENSE)
- orbit.go LICENSE: Apache License 2.0. — [orbit.go LICENSE](https://github.com/synadia-io/orbit.go/blob/jetstreamext/v0.3.2/LICENSE)
- No `NOTICE` file exists at the root of natscli v0.5.1, jsm.go v0.5.1 or nats.go v1.55.0. This was a directory listing of the cloned tags; see the trees at [natscli](https://github.com/nats-io/natscli/tree/v0.5.1), [jsm.go](https://github.com/nats-io/jsm.go/tree/v0.5.1) and [nats.go](https://github.com/nats-io/nats.go/tree/v1.55.0).
- Source files carry per-file headers, for example "Copyright 2025 The NATS Authors / Licensed under the Apache License, Version 2.0". — [natscli internal/util/headers.go L1-L12](https://github.com/nats-io/natscli/blob/v0.5.1/internal/util/headers.go#L1-L12)
- natscli's non-internal packages are `cli/` (fisk commands, `registerCommand(...)`) and `options/`. Its internal packages are `asciigraph`, `auth`, `bench`, `exporter`, `fips`, `scaffold` and `util`. — [natscli tree v0.5.1](https://github.com/nats-io/natscli/tree/v0.5.1)
- The internal-package rule: [Go 1.4 release notes](https://go.dev/doc/go1.4#internalpackages). The local build confirmation is in §5.
- natscli's go.mod pulls in CLI-only dependencies (survey, fisk, termui, go-pretty, prometheus client, jwt-auth-builder, and others), so importing `natscli/cli` would bring all of them in. — [natscli go.mod L5-L39](https://github.com/nats-io/natscli/blob/v0.5.1/go.mod#L5-L39)

### Inferences
- What to reuse by import: `jsm.go` (`natscontext`, root `jsm`, `api`, `serverdata`), `nats.go` + `nats.go/jetstream`, `nats-server/v2/server` (types only), and optionally `orbit.go/jetstreamext`.
- What to reuse by copying, with attribution: natscli `internal/util` `PubReplyBodyTemplate` and `RandomString`, and possibly the header parsing.
- Apache-2.0 §4 requires keeping the licence text and copyright notices in redistributed source, and stating changes in modified files. The Go binary should ship a third-party licences file covering all modules, for example generated with `go-licenses`. This is a standard Apache-2.0 obligation rather than something stated in these repositories.
- Do not import `natscli/cli`. It registers fisk commands in `init()` (via `registerCommand`), has a heavy dependency tree, and is not designed as an API.

### Gaps
- I did not perform a legal review of the transitive dependencies' licences, for example antithesis-sdk-go, go-tpm or expr-lang, which arrive through jsm.go and nats-server.
