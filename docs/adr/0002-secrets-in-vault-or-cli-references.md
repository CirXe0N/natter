# Secrets live in the Vault or behind CLI-compatible references, never in plaintext

The app never writes a Plaintext secret: no literal passwords, tokens or seeds, and no `data:` (base64) embedded creds. A secret it stores goes into the app's own Vault by default, or behind a Secret reference that natscli also understands (`env://`, `op://`, `nsc://`). natscli has no keyring support and passes unknown schemes through as the literal secret, so Contexts that reference the Vault live in the app's own config directory rather than `~/.config/nats/context/`; CLI-compatible Contexts may still be written there.

The Vault is the OS keyring via `zalando/go-keyring` where one is available. Where no keyring is available (headless Linux, or a desktop without a Secret Service provider), it is an age-encrypted file, unlocked by a key file passed on the command line, or else by a passphrase typed into the UI and held only in memory. The key is never read from an environment variable, because environment variables are inherited by child processes and readable by other tools running as the same user.

## Considered options

- **`99designs/keyring`**: rejected. It is unmaintained since 2022, and its encrypted-file backend uses PBES2 with a fixed 8192 iterations.
- **Only CLI-compatible references, no Vault**: rejected. It is secure only if the user already runs 1Password or manages environment secrets.
- **Keep sharing one directory with natscli for every Context**: rejected. A Vault reference in a shared file makes natscli send `keyring://…` as the password or fail.

## Consequences

- Existing CLI contexts that hold Plaintext secrets still work; the app flags them and offers to move the secret into the Vault, and never edits CLI files without asking.
- After a restart without a key file, an encrypted-file Vault stays locked until someone enters the passphrase in the UI.
