# Natter

Natter, a UI for NATS™: a web console for exploring and operating NATS deployments, from a local dev server up to shared clusters.

## Language

**Context**:
A saved target the UI can connect to: one NATS deployment's server URLs plus the credentials to reach it. Same meaning as a `nats` CLI context; exactly one is active at a time.
_Avoid_: Connection, server, profile, environment

**System credentials**:
Optional second credentials on a Context, for a user in the system account, that unlock server-wide data such as server stats, Connections and cluster state.
_Avoid_: Admin credentials, root user

**Monitoring URL**:
Optional address of a server's HTTP monitoring port on a Context, used as a read-only fallback when System credentials are absent.
_Avoid_: Metrics endpoint, stats URL

**Vault**:
The app's own encrypted store for Context secrets: one encrypted file, unlocked by a key file, a passphrase, or the OS keyring holding its key. The keyring never holds the secrets themselves.
_Avoid_: Keychain, secret store, wallet

**Secret reference**:
A Context field value that says where a secret lives (the Vault, an environment variable, 1Password, nsc) instead of holding the secret itself.
_Avoid_: Credential URI, indirection

**Plaintext secret**:
A secret anyone can read from disk without a key: a literal or base64-embedded value in a context file, or a creds, nkey or TLS key file referenced by path.
_Avoid_: Insecure credential, embedded secret

**Connection**:
A client connected to a NATS server, as listed by the server's connection monitoring.
_Avoid_: Client, session

**Read-only mode**:
A per-Context lock that blocks every action that changes server state or data while the Context is active. It blocks sending any message, requests included, because the app cannot know what a responding service does with a request. Browsing is the one exception: its transient ephemeral consumers are allowed.
_Avoid_: Safe mode, view-only

**Launch token**:
A random value the app prints at startup that a browser must present once to get a session; until the UI has login, it is what proves a request comes from the person running the app. In launcher mode (`natter open`, which the app launcher entry runs) it is not printed: it travels in the launch URL that natter hands the app window, or in a redirect file with `-redirect-file`.
_Avoid_: Access token, auth token, NATS token (that is a NATS credential type)

**Browsing**:
Reading messages or KV entries without changing any stream, KV entry or consumer's state: no durable consumers, no acknowledgements, no change to any consumer's position. It leaves one transient trace: the create and delete advisories of its ephemeral consumers.
_Avoid_: Consuming, reading (when side effects are implied)

**Example message**:
A saved, named message (subject, headers, payload, and whether it is published or sent as a request) that belongs to exactly one Context and can be sent again for testing. Copying or importing it into another Context creates an independent copy there.
_Avoid_: Template, snippet, saved request, dummy message

**Placeholder**:
A `{{…}}` token in an Example message's subject, headers or payload that is replaced with a fresh value on every send, using the same names as natscli's template functions (`{{Count}}`, `{{ID}}`, `{{TimeStamp}}`, …).
_Avoid_: Variable, template tag, macro

**Live tail**:
A rate-capped view of messages on a subject filter as they are published, which reports how many messages it dropped.
_Avoid_: Subscribe, stream (the verb), monitor
