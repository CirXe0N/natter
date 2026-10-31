# Secrets live in the Vault or behind CLI-compatible references, never in plaintext

The app never writes a Plaintext secret: no literal passwords, tokens or seeds, and no `data:` (base64) embedded creds. A secret it stores goes into the app's own Vault by default, or behind a Secret reference that natscli also understands (`env://`, `op://`, `nsc://`). natscli has no keyring support and passes unknown schemes through as the literal secret, so Contexts that reference the Vault live in the app's own config directory rather than `~/.config/nats/context/`; CLI-compatible Contexts may still be written there.

Every Vault secret lives in one age-encrypted file in the app's own config directory, encrypted to a hybrid post-quantum age identity: the Vault key. Only the key moves between unlock methods. It is a plaintext age identity file passed on the command line, or an scrypt-wrapped copy of it unlocked by a passphrase typed into the UI and held only in memory, or, where one is available, an item in the OS keyring via `zalando/go-keyring`. The keyring holds only the Vault key, never individual secrets, so its size limits do not apply and switching unlock method re-wraps the key without re-encrypting the secrets. The key is never read from an environment variable, because environment variables are inherited by child processes and readable by other tools running as the same user. TLS client keys stay out of the Vault in v1: nats.go reads them only as file paths.

## Considered options

- **`99designs/keyring`**: rejected. It is unmaintained since 2022, and its encrypted-file backend uses PBES2 with a fixed 8192 iterations.
- **Only CLI-compatible references, no Vault**: rejected. It is secure only if the user already runs 1Password or manages environment secrets.
- **One keyring item per secret**: rejected. Windows and macOS cap an item at about 2.5 to 3 KB, too small for some creds files, and each item can prompt for its own unlock.
- **Keep sharing one directory with natscli for every Context**: rejected. A Vault reference in a shared file makes natscli send `keyring://…` as the password or fail.

## Consequences

- Existing CLI contexts that hold Plaintext secrets still work; the app flags them and offers to move the secret into the Vault, and never edits CLI files without asking.
- After a restart without a key file or a keyring, the Vault stays locked until someone enters the passphrase in the UI. Connecting to a Context whose secret is in a locked Vault fails at once and asks for the unlock, instead of waiting.
