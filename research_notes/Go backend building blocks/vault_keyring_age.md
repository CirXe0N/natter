# Secrets Vault in Go: OS keyring (zalando/go-keyring) with an age-encrypted file fallback

Scope: implementation guide for the nats-ui Vault in ADR 0002 (`docs/adr/0002-secrets-in-vault-or-cli-references.md`). Research date 2026-10-31. Most facts were read straight from source code at the stated tags/commits (repositories cloned 2026-10-31), so many citations are GitHub file URLs.

Versions referenced:
- zalando/go-keyring **v0.2.8** (tagged 2026-03-23); `master` at 66b55cc (2026-07-24)
- filippo.io/age **v1.3.2** (2026-08-29); v1.3.0 was 2025-12-27
- nats-io/jsm.go **v0.5.1** (2026-10-26); natscli pins `v0.5.2-0.20261029121945-9aa1e6cf510c`
- nats-io/nsc **v2.15.0** (2026-06-02)
- Go **1.27.x** (pkg.go.dev shows go1.27.3)
- awnumar/memguard **v0.23.0** (2025-08-27); master was active in 2026-05

---

## 1. zalando/go-keyring: API, size limits, cgo, headless and SSH behaviour, and Secret Service providers

### Takeaway
The latest release, go-keyring v0.2.8 (2026-03-23), offers only `Set`, `Get`, `Delete` and `DeleteAll` on string values. `ListUsers` is merged on `master` but is not in any tag yet. It needs no cgo on Linux, macOS or Windows. The secret limits are small: 2560 bytes on Windows and about 3000 bytes (after base64) on macOS. The library has no timeout and no "is a provider available?" check, and on Linux it may start `dbus-launch` itself and then block forever on an unlock prompt. So nats-ui must run its own D-Bus probe before using it, and wrap every call in a timeout, as GitHub CLI does.

### Cited Findings

**API and versions**
- The package-level API is `Set(service, user, password string) error`, `Get(service, user string) (string, error)`, `Delete(service, user string) error`, `DeleteAll(service string) error`, and on master `ListUsers(service string) ([]string, error)`. There are sentinel errors `ErrNotFound` and `ErrSetDataTooBig`. — [keyring.go (master)](https://github.com/zalando/go-keyring/blob/master/keyring.go)
- `ListUsers` came in with PR #135 ("feat/list-user-names-by-service"), merged 2026-06-16, which is after v0.2.8 (2026-03-23). `git show v0.2.8:keyring.go` has no `ListUsers`, so it is unreleased as of 2026-10-31. The tags are v0.2.8 (2026-03-23), v0.2.7 (2026-03-20) and v0.2.6 (2024-10-25). — [go-keyring tags](https://github.com/zalando/go-keyring/tags); [PR #135](https://github.com/zalando/go-keyring/pull/135); [v0.2.8 keyring.go](https://github.com/zalando/go-keyring/blob/v0.2.8/keyring.go)
- `DeleteAll("")` returns `ErrNotFound` on purpose, "otherwise it might accidentally delete all secrets". — [keyring_unix.go](https://github.com/zalando/go-keyring/blob/master/keyring_unix.go)
- For tests there are `MockInit()`, `MockInitWithError(err)` and `MockRestore()` (an in-memory provider). — [keyring_mock.go](https://github.com/zalando/go-keyring/blob/master/keyring_mock.go)
- On other operating systems every call returns `ErrUnsupportedPlatform` ("unsupported platform: <GOOS>"). — [keyring_fallback.go](https://github.com/zalando/go-keyring/blob/master/keyring_fallback.go)
- go.mod declares `go 1.18`. The dependencies are `github.com/danieljoos/wincred v1.2.3` and `github.com/godbus/dbus/v5 v5.2.2`. — [go.mod](https://github.com/zalando/go-keyring/blob/master/go.mod)

**Size limits**
- The library's own comment on `ErrSetDataTooBig` says: "On MacOS: The combination of service, username & password should not exceed ~3000 bytes. On Windows: The service is limited to 32KiB while the password is limited to 2560 bytes. On Linux/Unix: There is no theoretical limit but performance suffers with big values (>100KiB)". — [keyring.go](https://github.com/zalando/go-keyring/blob/master/keyring.go)
- On Windows, `Set` rejects a password over 2560 bytes and a service of 512 bytes or more. The credential target name is `service + ":" + username`. — [keyring_windows.go](https://github.com/zalando/go-keyring/blob/master/keyring_windows.go)
- Microsoft documents that `CredentialBlobSize` "cannot be larger than CRED_MAX_CREDENTIAL_BLOB_SIZE (5*512) bytes". For a generic credential, TargetName is at most 32767 characters (CRED_MAX_GENERIC_TARGET_NAME_LENGTH) and is case-insensitive, and UserName is at most 513 characters. — [CREDENTIALW (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- wincred's `NewGenericCredential` sets `Persist = PersistLocalMachine`. Microsoft says CRED_PERSIST_LOCAL_MACHINE persists across logon sessions on the same computer and is "not visible to logon sessions for this user on other computers", so it does not roam, unlike CRED_PERSIST_ENTERPRISE. — [wincred.go v1.2.3](https://github.com/danieljoos/wincred/blob/v1.2.3/wincred.go); [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- On macOS the library shells out to `/usr/bin/security`. `Set` base64-encodes the password and adds the prefix `go-keyring-base64:`, then writes `add-generic-password -U -s <svc> -a <user> -w <pw>` to `security -i` on stdin. It returns `ErrSetDataTooBig` if that command line is over 4096 bytes. Because the password does not go in argv, it is not visible in `ps`. — [keyring_darwin.go](https://github.com/zalando/go-keyring/blob/master/keyring_darwin.go)
- An open issue (#154, 2026-09) reports that on macOS a backslash in the service or account name is silently stripped by `security -i`'s parser, so `Set` succeeds under a different name and `Get` returns not found. A single quote fails loudly. — [issue #154](https://github.com/zalando/go-keyring/issues/154)

**cgo**
- The Unix backend's build constraint is `(dragonfly && cgo) || (freebsd && cgo) || linux || netbsd || openbsd`. Linux needs no cgo; FreeBSD and DragonFly do. — [keyring_unix.go](https://github.com/zalando/go-keyring/blob/master/keyring_unix.go)
- The README says the library "aims to simplify using statically linked binaries, which is cumbersome when relying on C bindings". macOS uses `/usr/bin/security` and Windows uses wincred, which is syscall-based. CI also checks that `CGO_ENABLED=0 go build` works on FreeBSD; there the keyring functionality is disabled. — [README](https://github.com/zalando/go-keyring/blob/master/README.md); [CI workflow](https://github.com/zalando/go-keyring/blob/master/.github/workflows/go.yml)

**How the Linux Secret Service backend works, and how it fails**
- It connects with `dbus.SessionBus()` to the bus name `org.freedesktop.secrets` at `/org/freedesktop/secrets`. It uses the collection `/org/freedesktop/secrets/collection/login` if that exists, and otherwise the alias `/org/freedesktop/secrets/aliases/default`. Items carry the attributes `{"username": user, "service": service}` and the label `Password for '<user>' on '<service>'`. `CreateItem` is called with `replace=true`. — [keyring_unix.go](https://github.com/zalando/go-keyring/blob/master/keyring_unix.go); [secret_service.go](https://github.com/zalando/go-keyring/blob/master/secret_service/secret_service.go)
- Sessions are opened with algorithm `"plain"`. The Secret Service spec says "The plain algorithm does no encryption whatsoever", so the secret crosses the session bus unencrypted. Only processes on the same bus can see it. — [secret_service.go](https://github.com/zalando/go-keyring/blob/master/secret_service/secret_service.go); [Secret Service spec, Algorithm: plain](https://specifications.freedesktop.org/secret-service/latest/ch07s02.html)
- `NewSecret` sets `content_type` to `text/plain; charset=utf-8` when the value is valid UTF-8 and to `application/octet-stream` otherwise (commit d0e2b45, 2026-05, after v0.2.8). — [secret_service.go](https://github.com/zalando/go-keyring/blob/master/secret_service/secret_service.go)
- `handlePrompt` calls `Prompt.Prompt` and then blocks on `signal := <-promptSignal` with no timeout. The public API takes no `context.Context`. — [secret_service.go](https://github.com/zalando/go-keyring/blob/master/secret_service/secret_service.go)
- Open issue #118 asks for a way to "fail quickly without a prompt when run non-interactively", because `Get` hangs in `handlePrompt` when no user can answer. Issue #125 ("Hanging on WSL/Windows") points to GitHub CLI's wrapper; a maintainer replied, "I guess it would make sense to have timeout support in go-keyring itself", but nothing has been released. — [issue #118](https://github.com/zalando/go-keyring/issues/118); [issue #125](https://github.com/zalando/go-keyring/issues/125)
- GitHub CLI wraps every `Set`, `Get` and `Delete` in a goroutine with a `time.After(60 * time.Second)` select and returns a `TimeoutError`. — [cli/cli internal/keyring/keyring.go](https://github.com/cli/cli/blob/trunk/internal/keyring/keyring.go)
- godbus `SessionBus()` first reads `DBUS_SESSION_BUS_ADDRESS`, then tries to discover an existing bus (for example `/run/user/<uid>/bus`). If neither works it autolaunches with `exec.Command("dbus-launch")` and calls `os.Setenv` with the result. `SessionBusPrivateNoAutoStartup` "do[es] not attempt to launch it". — [godbus conn.go v5.2.2](https://github.com/godbus/dbus/blob/v5.2.2/conn.go); [godbus conn_other.go v5.2.2](https://github.com/godbus/dbus/blob/v5.2.2/conn_other.go)
- Headless and container failures: issue #116 reports `failed to unlock correct collection '/org/freedesktop/secrets/aliases/default'` on a desktop-free VM even with gnome-keyring and dbus-x11 installed. The maintainer replied: "It works on Linux, but there are prerequisites like a working keyring. The tool is intended for human users… which normally assumes a desktop environment." Issue #45 shows the same error in Docker. — [issue #116](https://github.com/zalando/go-keyring/issues/116); [issue #45](https://github.com/zalando/go-keyring/issues/45)
- The project's own headless CI recipe runs `dbus-run-session -- bash`, creates `~/.local/share/keyrings/` with mode 700, and then runs `echo 'somecredstorepass' | gnome-keyring-daemon --unlock` before the tests. — [CI workflow](https://github.com/zalando/go-keyring/blob/master/.github/workflows/go.yml)
- The README says the Linux backend expects the `login` collection and tells users to create one in Seahorse if it is missing. — [README](https://github.com/zalando/go-keyring/blob/master/README.md)
- WSL: open issue #149 (2026-07) asks for Windows Credential Manager support from inside WSL, so a Linux binary in WSL gets only Secret Service. — [issue #149](https://github.com/zalando/go-keyring/issues/149)

**Providers**
- KeePassXC: "Only one secret service provider can be enabled at a time." You enable it in Tools → Settings → Secret Service Integration. Each open database is one collection, exposed through a chosen group. Access can require confirmation, and with `secret-tool` "you will be prompted each time credentials are requested" (each run is a new PID). You "may have to disable other providers, such as GNOME Keyring or KWallet". — [KeePassXC SecretService.adoc](https://github.com/keepassxreboot/keepassxc/blob/develop/docs/topics/SecretService.adoc)
- Open issue #88 reports go-keyring and KeePassXC freezing and returning `org.freedesktop.Secret.Error.IsLocked`. The GitHub CLI maintainer comments there about "freezes and slow credential lookups". — [issue #88](https://github.com/zalando/go-keyring/issues/88)
- KWallet has provided the `org.freedesktop.secrets` API since KDE Frameworks 5.97.0, through `KWalletFreedesktopService` at `/org/freedesktop/secrets`. — [Arch bug FS#75616](https://bugs.archlinux.org/task/75616); [KWallet API source](https://api.kde.org/frameworks/kwallet/html/kwalletfreedesktopservice_8h_source.html)
- The Secret Service spec page is titled "Secret Service API Draft", version 0.2 DRAFT. — [Secret Service spec](https://specifications.freedesktop.org/secret-service/latest/)

### Inferences
- **Pin `v0.2.8`. Don't rely on `ListUsers`** until a v0.2.9 or later tag exists. Keep the Vault's own index of keys instead (see §3), or pin a master pseudo-version on purpose.
- **Probe before use, on Linux only.** go-keyring's `SessionBus()` may autolaunch `dbus-launch` and change the process environment, so do the availability check yourself on a private, no-autostart connection:
  ```go
  // linux only
  func secretServiceAvailable(ctx context.Context) bool {
      conn, err := dbus.SessionBusPrivateNoAutoStartup()
      if err != nil { return false }            // no session bus (SSH without pam_systemd, containers)
      defer conn.Close()
      if err = conn.Auth(nil); err != nil { return false }
      if err = conn.Hello(); err != nil { return false }
      var owned bool
      _ = conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.NameHasOwner", 0,
          "org.freedesktop.secrets").Store(&owned)
      if owned { return true }
      var names []string                         // activatable (e.g. gnome-keyring via .service file)
      _ = conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.ListActivatableNames", 0).Store(&names)
      return slices.Contains(names, "org.freedesktop.secrets")
  }
  ```
  Then run a **canary round-trip** (`Set`/`Get`/`Delete` of `nats-ui`/`__probe__`) under a timeout of about 5–10 s. A locked collection with no one to answer the prompt (SSH, headless) shows up as a timeout. Mark the keyring unusable for this process and fall back to the age file. The goroutine stuck in `handlePrompt` leaks; that is acceptable for a one-off probe. (This follows from the blocking `handlePrompt` and the godbus autolaunch behaviour cited above.)
- **Wrap every call** in the same pattern as GitHub CLI's, but with a `context.Context` deadline. Use a short deadline for the probe, and a long one (about 60 s) for interactive unlock on a desktop, where a real user may be typing the keyring password.
- **Over SSH**: if the user has a systemd user session, `/run/user/<uid>/bus` exists. gnome-keyring may then be activatable but locked, because PAM unlocks the login keyring only at graphical login. Expect a hang, which is what the timeout and fallback handle. If there is no bus, `SessionBusPrivateNoAutoStartup` fails fast. No source documents this exact SSH sequence; it is inferred from the godbus discovery code and issues #116/#118.
- **Size**: a NATS `.creds` file (user JWT plus seed plus banner text) can approach or exceed Windows' 2560-byte blob limit, and macOS's roughly 3000 bytes after base64. Seeds (about 58 chars), passwords and tokens fit easily. The size of real creds files was not measured; see Gaps. So either (a) check `len` before `Set` and route big values to the file vault, or (b) use the keyring only for the vault key (recommended, §3).
- **Name validation**: forbid `\` and `'` in service and account names because of macOS issue #154. Windows target names are case-insensitive, so normalise account keys to lowercase or treat them as case-insensitive.

### Gaps
- Apple publishes no size limit for generic-password Keychain items that I could find; the ~3000-byte figure is go-keyring's own, caused by its 4096-byte `security -i` command-line limit.
- I couldn't confirm from KeePassXC docs whether KeePassXC provides the `login` collection or the `default` alias that go-keyring needs. Issue #88 suggests the integration is fragile; test it by hand.
- I didn't find an authoritative source describing go-keyring's macOS Keychain ACL behaviour, i.e. whether items created through `/usr/bin/security` can be read by any process as the same user that calls `security`. Worth testing; it bears on the threat model.

---

## 2. filippo.io/age: passphrase vs X25519/hybrid identities, scrypt defaults, armor, file format, plugins and post-quantum

### Takeaway
Use an **age identity file** (`AGE-SECRET-KEY-1…` or post-quantum `AGE-SECRET-KEY-PQ-1…`) as the "key file passed on the command line", not a passphrase file. The age library's passphrase mode (`ScryptRecipient`) must be the *only* recipient of a file. So to support both unlock methods, encrypt the vault to an identity, and keep that identity either in a plaintext key file (CLI flag) or in a scrypt-wrapped copy unlocked by the UI passphrase. That is the same "passphrase-protected key file" pattern the age CLI supports.

### Cited Findings
- Release: age v1.3.0 was tagged 2025-12-27, v1.3.1 on 2025-12-28 and v1.3.2 on 2026-08-29. go.mod says `go 1.25.0` and depends on `filippo.io/hpke`. — [age releases](https://github.com/FiloSottile/age/releases); [go.mod](https://github.com/FiloSottile/age/blob/v1.3.2/go.mod)
- Core API: `age.Encrypt(dst io.Writer, recipients ...Recipient) (io.WriteCloser, error)`, `age.Decrypt(src io.Reader, identities ...Identity) (io.Reader, error)`, plus `EncryptReader`, `DecryptReaderAt`, `ExtractHeader`/`DecryptHeader` and the error type `NoIdentityMatchError`. — [age.go](https://github.com/FiloSottile/age/blob/v1.3.2/age.go)
- Scrypt: `NewScryptRecipient(password string)` uses a default work factor of `18` ("1s on a modern machine"), changeable with `SetWorkFactor(logN)` (1–30, panics otherwise). `NewScryptIdentity` accepts up to `maxWorkFactor: 22` ("15s on a modern machine"), changeable with `SetMaxWorkFactor`. An empty passphrase is an error. — [scrypt.go](https://github.com/FiloSottile/age/blob/v1.3.2/scrypt.go)
- The doc comment says `ScryptRecipient` "must be the only recipient for the file: it can't be mixed with other recipient types", and "Its use is not recommended for automated systems, which should prefer [HybridRecipient] or [X25519Recipient]." — [scrypt.go](https://github.com/FiloSottile/age/blob/v1.3.2/scrypt.go)
- Spec: the scrypt stanza is `-> scrypt <base64 salt(16 bytes)> <logN>`, with wrap key = `scrypt(N=2^logN, r=8, p=1, dkLen=32, S="age-encryption.org/v1/scrypt"||salt, P=passphrase)` and ChaCha20-Poly1305 using a zero nonce. "An scrypt stanza, if present, MUST be the only stanza in the header." Identities "SHOULD apply an upper limit to the work factor". — [C2SP age.md](https://github.com/C2SP/C2SP/blob/main/age.md)
- Native keys: `GenerateX25519Identity()`, `ParseX25519Identity`, `(*X25519Identity).Recipient()`. The post-quantum keys are `GenerateHybridIdentity()`, `ParseHybridIdentity` (`AGE-SECRET-KEY-PQ-1…`) and `ParseHybridRecipient` (`age1pq1…`). — [x25519.go](https://github.com/FiloSottile/age/blob/v1.3.2/x25519.go); [pq.go](https://github.com/FiloSottile/age/blob/v1.3.2/pq.go)
- The doc comment on `HybridRecipient` calls it "the standard age public key… safe against future cryptographically-relevant quantum computers, and can only be used along with other post-quantum recipients" (enforced by a `postquantum` label). It uses the MLKEM768-X25519 HPKE KEM (stanza type `mlkem768x25519`). — [pq.go](https://github.com/FiloSottile/age/blob/v1.3.2/pq.go); [C2SP age.md](https://github.com/C2SP/C2SP/blob/main/age.md)
- README: "Support for post-quantum keys is built into age v1.3.0 and later." Post-quantum recipients "are unfortunately ~2000 characters long", and `age-keygen -pq` "may become the default in the future". — [age README](https://github.com/FiloSottile/age/blob/v1.3.2/README.md)
- `ParseIdentities(io.Reader)` reads one key per line and skips `#` comments and blank lines. It is capped at 16 MiB and currently returns only `*X25519Identity` or `*HybridIdentity`. It does not handle SSH keys or plugins ("which involve invoking external programs"), and its error messages never include the key line. — [parse.go](https://github.com/FiloSottile/age/blob/v1.3.2/parse.go)
- The package docs say "There is no default path for age keys… they should be stored at application-specific paths", and "it's recommended that you only support native (X25519 and hybrid) keys, and not SSH keys". The same docs list "as environment variables" as acceptable key storage; ADR 0002 rejects that for nats-ui. — [age.go package doc](https://github.com/FiloSottile/age/blob/v1.3.2/age.go)
- Passphrase-protected key files (CLI): "If an identity file passed to `-i` is a passphrase encrypted age file, it will be automatically decrypted" (`age-keygen | age -p > key.age`). They are "not necessary for most use cases, where access to the encrypted identity file implies access to the whole system". — [age README](https://github.com/FiloSottile/age/blob/v1.3.2/README.md)
- File format: a textual header (`age-encryption.org/v1`, then stanzas, then `--- <HMAC-SHA-256 MAC>`, keyed by HKDF(file key, "header")). After it comes a 16-byte nonce and a payload in 64 KiB ChaCha20-Poly1305 chunks; the last nonce byte is 0x01 for the final chunk. Decryption is streamed, and the file is only authenticated once the final chunk decrypts. — [C2SP age.md](https://github.com/C2SP/C2SP/blob/main/age.md)
- Armor: strict PEM (RFC 7468) with label `AGE ENCRYPTED FILE`. Armored files "are malleable unless care is taken". In Go these are `armor.NewWriter` and `armor.NewReader`, with `armor.Header = "-----BEGIN AGE ENCRYPTED FILE-----"`. — [C2SP age.md](https://github.com/C2SP/C2SP/blob/main/age.md); [armor/armor.go](https://github.com/FiloSottile/age/blob/v1.3.2/armor/armor.go)
- Plugins: `filippo.io/age/plugin` offers `NewIdentity(s string, ui *ClientUI)`, `NewRecipient` and `NewTerminalUI`, and runs `age-plugin-<name>` binaries (for example age-plugin-yubikey for PIV tokens). The repo ships `extra/age-plugin-pq`, `age-plugin-tag` and `age-plugin-tagpq`. — [plugin/client.go](https://github.com/FiloSottile/age/blob/v1.3.2/plugin/client.go); [age README](https://github.com/FiloSottile/age/blob/v1.3.2/README.md)
- Compatibility: "Files encrypted with a stable version… will decrypt with any later versions of the v1 API." — [age.go package doc](https://github.com/FiloSottile/age/blob/v1.3.2/age.go)

### Inferences
- **Key file = age identity file.** It is high-entropy, so it needs no slow KDF and avoids a 1 s scrypt cost on every start-up. It parses with `age.ParseIdentities` and is interoperable: the user can run `age -d -i key.txt vault.age` to recover. A "passphrase file" would mean scrypt plus a secret stored in plaintext anyway, with no benefit.
- **Default to a hybrid post-quantum identity** (`GenerateHybridIdentity`) for new vaults. It is in v1.3.0+, the package docs call it "the standard age public key", and the ~2000-character recipient size doesn't matter because nats-ui derives the recipient from the identity. Accept X25519 key files the user supplies (`age-keygen` without `-pq`). Don't support plugins or SSH keys in v1. Plugins run external binaries and need an interactive `ClientUI`, which a web-UI app doesn't have; YubiKey support could come later.
- **Two-layer layout so both unlock paths work despite "scrypt must be the only recipient":**
  ```
  <appdir>/vault.age        # payload, encrypted to the vault identity's recipient (hybrid PQ or X25519)
  <appdir>/vault.key.age    # (passphrase mode) the identity file itself, age -p (scrypt) encrypted
  --key-file /path/key.txt  # (key-file mode) plaintext identity file, user-managed
  keyring item              # (keyring mode, optional - §3) the identity string stored in the OS keyring
  ```
  ```go
  // Unlock with the key file from the CLI flag.
  f, _ := os.Open(keyFile); ids, err := age.ParseIdentities(f)

  // Unlock with the passphrase typed into the UI.
  sid, _ := age.NewScryptIdentity(pass)        // keep the default max work factor of 22
  r, err := age.Decrypt(bytes.NewReader(wrappedKey), sid)
  if errors.As(err, new(*age.NoIdentityMatchError)) { /* wrong passphrase */ }
  ids, err = age.ParseIdentities(r)

  // Decrypt the vault.
  r, err = age.Decrypt(vaultFile, ids...)
  data, _ := io.ReadAll(io.LimitReader(r, 16<<20))

  // Re-encrypt the vault.
  rcpt := ids[0].(*age.HybridIdentity).Recipient()   // or *X25519Identity
  w, _ := age.Encrypt(tmp, rcpt); w.Write(payload); w.Close()
  ```
  Changing the passphrase rewrites only `vault.key.age`. The `vault.age` payload never changes.
- **Work factor**: keep the default of 18 for the wrapped key. Check passphrase strength in the UI (age's CLI auto-generates passphrases from a word list for this reason).
- **Don't armor.** The files stay local, binary is smaller, and the age spec warns that armor is malleable. Offer armored export only for copy-and-paste backups.

### Gaps
- I didn't fetch age v1.3.x release notes beyond tag dates and the README, so no changelog-level detail on what v1.3.1 and v1.3.2 changed (v1.3.2 appears to be a doc and man-page regeneration).
- I found no benchmark for scrypt logN=18 on current hardware beyond the source comment "1s on a modern machine".

---

## 3. Storing many secrets: one file or one entry per secret, atomic writes, permissions, and memory hygiene

### Takeaway
Store the Vault as **one age file holding a versioned JSON map**, written atomically: a temp file in the same directory with mode 0600, fsync, rename, then fsync the directory. This is the pattern natscontext itself uses. For the keyring backend, prefer **one keyring item holding the vault identity** over one item per secret: it avoids the 2.5–3 KB limits and the unreleased `ListUsers`, and needs only one unlock prompt. memguard is overkill for this threat model. Use plain Go hygiene instead: `[]byte`, wiping, no `String()`/`fmt` exposure, `slog` redaction, and on Linux disabled core dumps. Go's `runtime/secret` is still experimental and Linux-only.

### Cited Findings
- natscontext's `writeFileAtomic` does `os.CreateTemp(dir, base+".tmp-*")`, then `tmp.Chmod(mode)`, `Write`, `Sync`, `Close`, `os.Rename`, and a best-effort fsync of the parent directory. Its comment: "A crash at any point leaves the destination either unmodified or containing the new content, never a partial write." Context files are written with mode `0600` and directories created with `0700`. — [jsm.go natscontext/backend_file.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/backend_file.go)
- `os.CreateTemp`: "The file is created with mode 0o600 (before umask)." `os.Rename`: "If newpath already exists and is not a directory, Rename replaces it… Even within the same directory, on non-Unix platforms Rename is not an atomic operation." — [pkg.go.dev/os](https://pkg.go.dev/os)
- On Windows, Go's `os.Rename` calls `MoveFileEx(from, to, MOVEFILE_REPLACE_EXISTING)`. — [internal/syscall/windows/syscall_windows.go (go1.27)](https://github.com/golang/go/blob/release-branch.go1.27/src/internal/syscall/windows/syscall_windows.go); [os/file_windows.go](https://github.com/golang/go/blob/release-branch.go1.27/src/os/file_windows.go)
- natscontext's `resolveLiteral` wipes the resolver's returned byte slice (`wipeSlice(data)`) after converting it to a string. — [natscontext/credentials.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/credentials.go)
- `runtime/secret` (Go 1.26+) "is experimental, and not subject to the Go 1 compatibility promise", exists only with `GOEXPERIMENT=runtimesecret`, and is "Currently only supported on linux/amd64 and linux/arm64". `secret.Do(f)` erases registers and stack, and erases heap allocations only once the GC finds them unreachable. "Protection does not extend to any global variables written by f." Go 1.27 adds that goroutines started inside secret mode also run in secret mode. — [pkg.go.dev/runtime/secret](https://pkg.go.dev/runtime/secret); [Go 1.26 release notes](https://go.dev/doc/go1.26); [Go 1.27 release notes](https://go.dev/doc/go1.27)
- memguard keeps data encrypted in memory with XSalsa20Poly1305. It allocates outside the Go runtime with syscalls, adds guard pages and canaries, locks memory to prevent swapping, handles core dumps, and is "written in pure Go". Its "API is experimental and may have unstable changes. You should pin a version." The latest tag is v0.23.0 (2025-08-27). — [memguard README](https://github.com/awnumar/memguard/blob/master/README.md); [memguard tags](https://github.com/awnumar/memguard/tags)
- go-keyring's `Get` returns the secret as a Go `string`, which is immutable and cannot be wiped. — [keyring.go](https://github.com/zalando/go-keyring/blob/master/keyring.go)
- The age library deliberately keeps key material out of error strings ("Don't include arg in the error: it may contain private key material, and callers print these errors"). — [parse.go](https://github.com/FiloSottile/age/blob/v1.3.2/parse.go)

### Inferences
- **One file plus a map, not one file per secret.** Reasons: a single atomic replace keeps the vault consistent; one decrypt at unlock; listing comes free; less metadata leaks (file count and names reveal nothing). Vault sizes are tiny (KBs), so rewriting the whole file is cheap. Suggested payload:
  ```go
  type vaultFile struct {
      Version int                    `json:"v"`       // 1
      Entries map[string]vaultEntry `json:"entries"`  // key = Vault ID, see §5
  }
  type vaultEntry struct {
      Kind    string    `json:"kind"`   // password|token|nkey-seed|creds|jwt
      Secret  []byte    `json:"secret"` // base64 in JSON
      Updated time.Time `json:"updated"`
  }
  ```
- **Keyring backend: store the vault identity, not every secret.** Store `Set("nats-ui", "vault-key:<vault-id>", identity.String())`; an `AGE-SECRET-KEY-1…` is about 74 chars, and a PQ identity is short too, since only the recipient is ~2000 chars. The secrets live in the same `vault.age` as in the file fallback. Benefits: no `ErrSetDataTooBig` for creds files on Windows and macOS; no `ListUsers` (unreleased); one KeePassXC confirmation instead of one per secret; the same code path and file format for every backend, and switching backend means re-wrapping only the key. Cost: a ciphertext file exists on disk even with a keyring. ADR 0002 says "The Vault is the OS keyring", so its owner should confirm this refinement. If secret-per-item is kept instead, enforce a size check and route oversize values to the file.
- **Atomic write sketch.** This is the natscontext pattern plus a lock:
  ```go
  func writeAtomic(path string, data []byte) error {
      dir := filepath.Dir(path)
      if err := os.MkdirAll(dir, 0o700); err != nil { return err }
      t, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*") // 0600
      if err != nil { return err }
      defer os.Remove(t.Name()) // no-op after successful rename
      if _, err = t.Write(data); err == nil { err = t.Sync() }
      if cerr := t.Close(); err == nil { err = cerr }
      if err != nil { return err }
      if err = os.Rename(t.Name(), path); err != nil { return err }
      if d, err := os.Open(dir); err == nil { _ = d.Sync(); d.Close() } // durability on POSIX
      return nil
  }
  ```
  Stream `age.Encrypt` straight into the temp file, so plaintext never reaches the disk. Hold an in-process `sync.Mutex` for writes. Because "Rename is not an atomic operation" on non-Unix platforms, add a cross-process lock file (`vault.lock`, `O_CREATE|O_EXCL`, or `LockFileEx`/`flock`) if two nats-ui instances could share a config directory. On start-up, also check the vault file's mode and warn if it is group or world readable.
- **Memory and log hygiene.** memguard is not worth it here: the secrets must become Go `string`s anyway to be handed to `nats.UserInfo`, `nats.Token` and nkey callbacks, and go-keyring already returns `string`s, so enclaves give little real protection against a same-user attacker who can read the vault file or ptrace the process. Do the cheap things:
  - Use a `Secret` type with `String()`/`GoString()`/`MarshalJSON()`/`LogValue()` that returns `"[REDACTED]"`, so `fmt`, `slog` and `json` can't leak it by accident.
  - Keep decrypted secrets as `[]byte`, wipe them with `clear(b)` after use, and drop the decrypted map and identities when the Vault is locked.
  - Never put secret values in error messages, HTTP responses, panics or URLs. Follow age's rule of never including key material in errors.
  - On Linux, `unix.Prctl(unix.PR_SET_DUMPABLE, 0, …)` and `unix.Setrlimit(RLIMIT_CORE, 0)` at start-up stop core dumps and `ptrace` attach by same-user processes without CAP_SYS_PTRACE. Leave `GOTRACEBACK` at its default, since tracebacks don't print heap contents. *(These are standard Linux APIs; not checked against a source in this session, see Gaps.)*
  - `runtime/secret` could later wrap the decrypt-and-parse step on Linux. It is experimental, needs a build-time GOEXPERIMENT, and gives no protection for the long-lived decrypted map, so don't rely on it yet.

### Gaps
- I didn't cite primary docs in this session for `PR_SET_DUMPABLE`, `RLIMIT_CORE` or Windows Error Reporting and minidump behaviour. Check the man pages, `prctl(2)` and `setrlimit(2)`, before relying on the exact semantics.
- I didn't verify whether `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` gives crash-atomic replacement on NTFS. Microsoft does not promise atomicity, and Go's docs say rename is "not an atomic operation" on non-Unix platforms.

---

## 4. Where config and vault files live per platform, and natscli/nsc directory conventions

### Takeaway
The NATS tools ignore `os.UserConfigDir` and use **XDG-style paths on every OS** (`$XDG_CONFIG_HOME` or `~/.config`, plus `~/.local/share` for nsc data), even on macOS and Windows. For nats-ui, follow that and use `~/.config/nats/nats-ui/` (honouring `XDG_CONFIG_HOME`). The app then sits next to `~/.config/nats/context/` and `~/.config/nats/nsc/`, but in its own subdirectory so natscli never parses its Contexts.

### Cited Findings
- natscontext stores contexts as `<root>/nats/context/<name>.json`, the selection in `<root>/nats/context.txt` and `<root>/nats/previous-context.txt`. `root` is `$XDG_CONFIG_HOME`, falling back to `user.Current().HomeDir + "/.config"`, with no per-OS branch. — [natscontext/backend_file.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/backend_file.go); [natscontext/context.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/context.go)
- jsm.go v0.5.1 (2026-10-26) adds a pluggable `Backend` and `Selector` and `NewFileBackendAt(dir)`, which roots storage at `dir/nats/context/`. natscli's go.mod pins `github.com/nats-io/jsm.go v0.5.2-0.20261029121945-9aa1e6cf510c`. — [natscontext/backend_file.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/backend_file.go); [natscli go.mod](https://github.com/nats-io/natscli/blob/main/go.mod)
- nsc keeps config in `$XDG_CONFIG_HOME/nats/nsc` (default `~/.config/nats/nsc`, file `nsc.json`), stores in `$XDG_DATA_HOME/nats/nsc/stores` (default `~/.local/share/nats/nsc/stores`) and keys in `…/nats/nsc/keys`. These can be overridden with `NKEYS_PATH`, and `NSC_HOME` is defined in cmd/defaults.go. Legacy fallbacks are `~/.nsc/nsc.json`, `~/.nsc/nats` and `~/.nkeys`. nsc uses `mitchellh/go-homedir`, again with no per-OS branch. — [nsc home/home.go](https://github.com/nats-io/nsc/blob/main/home/home.go); [nsc cmd/defaults.go](https://github.com/nats-io/nsc/blob/main/cmd/defaults.go); [nsc cmd/store/keys.go](https://github.com/nats-io/nsc/blob/main/cmd/store/keys.go)
- nsc also hard-codes the natscli context directory as `filepath.Join(config, "nats", "context")`. — [nsc home/home.go](https://github.com/nats-io/nsc/blob/main/home/home.go)
- `os.UserConfigDir`: on Unix it returns `$XDG_CONFIG_HOME` if set, otherwise `$HOME/.config`; on Darwin `$HOME/Library/Application Support`; on Windows `%AppData%`; on Plan 9 `$home/lib`. It returns an error if `$XDG_CONFIG_HOME` is relative. Go has no `UserDataDir` or `UserStateDir`; only `UserCacheDir`, `UserConfigDir` and `UserHomeDir` exist. — [os/file.go (go1.27)](https://github.com/golang/go/blob/release-branch.go1.27/src/os/file.go); [pkg.go.dev/os](https://pkg.go.dev/os)

### Inferences
- Recommended layout. This is a convention choice; the NATS ecosystem precedent is cited above.
  ```
  $XDG_CONFIG_HOME|~/.config/nats/nats-ui/       (0700)
      config.json                 app settings, incl. vault backend + vault id
      context/<name>.json         nats-ui Contexts (may hold nats-ui-vault:// refs)  (0600)
      vault.age                   age-encrypted Vault (file backend, or keyring-wrapped key mode)  (0600)
      vault.key.age               scrypt-wrapped vault identity (passphrase mode)  (0600)
      vault.lock                  cross-process write lock
  ```
  Use the same rule as natscontext so the paths line up: `$XDG_CONFIG_HOME` if absolute, otherwise `~/.config`. That gives the same place on macOS and Windows as the CLI. Offer `--config-dir` to override. If you choose `os.UserConfigDir` for platform-native paths instead, nats-ui's files land in `~/Library/Application Support/nats-ui` and `%AppData%\nats-ui` while the CLI's are in `~/.config/nats`, which is harder to explain in docs.
- Using `natscontext.NewFileBackendAt("<…>/nats-ui")` would make the app's Contexts land at `~/.config/nats/nats-ui/nats/context/`. Either accept that nesting, or root it at `~/.config/nats-ui` so the result is `~/.config/nats-ui/nats/context/`. Decide deliberately: `NewFileBackendAt` always appends `nats/context`.
- The `--key-file` path is user-supplied and should live *outside* the config directory (for example on removable media). If it is inside, "access to the encrypted identity file implies access to the whole system" applies (age README), and the file encryption adds little.

### Gaps
- I didn't check the natscli source directly for other directories, such as natscli's own cache or plugin dirs. Only natscontext (jsm.go) and nsc were read.

---

## 5. Keyring service/account naming, and how a Vault reference is written into a Context

### Takeaway
Use service `nats-ui` and accounts of the form `<kind>:<id>`. Write references into nats-ui Contexts as a custom URI such as `nats-ui-vault://<entry-id>`. jsm.go's natscontext (v0.5.1+) has a pluggable `CredentialResolver` registry, so nats-ui can register a resolver for its scheme and keep using natscontext for loading and connecting. Stock natscli has no resolver for the scheme: it would send the reference string as a literal password or token, or fail for creds and nkey. That is why ADR 0002 keeps these Contexts out of `~/.config/nats/context/`.

### Cited Findings
- `type CredentialResolver interface { Schemes() []string; Resolve(ctx context.Context, ref string) ([]byte, error) }`. `WithCredentialResolver(r)` registers a resolver per scheme; passing it suppresses the automatic defaults, so combine it with `WithDefaultResolvers()` to keep `file://`, `op://`, `nsc://` and `env://`. An empty scheme `""` designates the fallback for bare values. — [natscontext/credentials.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/credentials.go); [natscontext/registry.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/registry.go)
- Password, token, user JWT and seed fields go through `resolveLiteral`. If no resolver matches the scheme, "anything else passes through unchanged", i.e. the literal string is used. The resolved value has `\r\n` trimmed at the end, and the resolver's byte slice is wiped. — [natscontext/credentials.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/credentials.go); [natscontext/context.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/context.go)
- For `Creds` and `NKey` fields, an unknown scheme fails with `creds: no resolver registered for scheme %q` or `nkey: no resolver registered for scheme %q`. — [natscontext/context.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/context.go)
- `parseScheme` requires a scheme of at least two characters, so Windows drive letters like `C:` are not taken as schemes. — [natscontext/credentials.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/credentials.go)
- The stock schemes documented in natscontext are `file://`, `op://vault/item/field`, `nsc://<operator>/<account>/<user>` and `env://NAME`. The embedding helpers turn file paths into `data:;base64,` URIs, leaving other schemes alone. — [natscontext/context.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/context.go); [natscontext/resolver_env.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/resolver_env.go); [natscontext/resolver_op.go](https://github.com/nats-io/jsm.go/blob/main/natscontext/resolver_op.go)
- go-keyring on Linux identifies items by the attributes `service` and `username`. On Windows the target is `service:username`, case-insensitive per Microsoft, and on macOS it is `-s service -a account`. — [keyring_unix.go](https://github.com/zalando/go-keyring/blob/master/keyring_unix.go); [keyring_windows.go](https://github.com/zalando/go-keyring/blob/master/keyring_windows.go); [keyring_darwin.go](https://github.com/zalando/go-keyring/blob/master/keyring_darwin.go); [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- Microsoft suggests prefixing a generic credential's TargetName with the company or service name. — [CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

### Inferences
- **Naming.** These are design choices, constrained by the facts above.
  - Keyring service: `nats-ui`, one constant. Don't put the vault path in it; Windows rejects services of 512 bytes or more.
  - Keyring account, in vault-key mode (recommended in §3): `vault-key:<vault-id>`, where `<vault-id>` is a random 128-bit base32 ID stored in `config.json`. The ID lets two installs or config directories share one keyring without clobbering each other.
  - If you store secrets per item instead: `secret:<entry-id>`.
  - Restrict IDs to `[a-z0-9-]`: lowercase because Windows matching is case-insensitive, and no `\` or `'` because of macOS issue #154.
  - Windows shows the target as `nats-ui:vault-key:…` in Credential Manager. Set a readable label where possible; on Linux go-keyring's label is fixed as `Password for '<user>' on '<service>'`.
- **Reference format** in nats-ui Contexts: `nats-ui-vault://<entry-id>`, for example `"password": "nats-ui-vault://e-7k3q…"`, `"creds": "nats-ui-vault://e-…"`, `"nkey": "nats-ui-vault://e-…"`. Entry IDs are opaque random IDs, not context names, so renaming a Context doesn't move secrets. Keep a `refs` count, or rescan Contexts, to find orphaned entries.
  - Use a distinctive scheme (`nats-ui-vault`, not `keyring` or `vault`). It won't collide with future natscli schemes such as a HashiCorp `vault://`, and if such a Context is ever loaded by natscli, the leaked "password" is visibly a reference and not a secret.
  - `nats-ui-vault://` is at least two characters and a valid URI scheme, so `parseScheme` accepts it.
- **Resolver sketch.** This plugs into natscontext:
  ```go
  type vaultResolver struct{ v *Vault }
  func (vaultResolver) Schemes() []string { return []string{"nats-ui-vault"} }
  func (r vaultResolver) Resolve(ctx context.Context, ref string) ([]byte, error) {
      id := strings.TrimPrefix(ref, "nats-ui-vault://")
      b, err := r.v.Get(ctx, id)             // ErrLocked if file vault not unlocked yet
      if err != nil { return nil, fmt.Errorf("vault %q: %w", id, err) } // id only, never value
      return bytes.Clone(b), nil              // natscontext wipes the returned slice
  }

  reg := natscontext.NewRegistry(natscontext.NewFileBackendAt(appRoot),
      natscontext.WithDefaultResolvers(),
      natscontext.WithCredentialResolver(vaultResolver{v}))
  ```
  If the Vault is locked, `Resolve` returns a typed `ErrLocked`, which the UI turns into "Unlock the Vault". This matches ADR 0002's "stays locked until someone enters the passphrase in the UI".
- **Migration from plaintext CLI Contexts**, per ADR 0002 Consequences: read the secret from `~/.config/nats/context/x.json`, `Vault.Put(newID, secret)`, then write the nats-ui copy of the Context with `nats-ui-vault://newID`. Change the CLI file only with explicit consent, and only to a CLI-compatible reference (`env://`, `op://`, `nsc://`), never to `nats-ui-vault://`.

### Gaps
- The `CredentialResolver` registry is new in jsm.go v0.5.x (October 2026). I didn't check whether its API is marked stable or how long it has existed before v0.5.1; pin the version.
- I didn't verify whether upstream natscli plans a plugin mechanism for third-party schemes. If it gets one, the "separate directory" rule in ADR 0002 could be relaxed.
