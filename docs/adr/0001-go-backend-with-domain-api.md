# Go backend with a domain API; the browser never connects to NATS

The UI is a web app served by a Go backend, shipped as one binary with the frontend embedded. The backend holds all credentials, talks to NATS over native TCP, and exposes a domain API (operations such as "list streams" or "purge stream", plus a WebSocket for live data) to the browser. We rejected a browser-only app using nats.js over the server's WebSocket listener, and a thin backend that relays raw NATS to the browser, because Read-only mode must be enforced server-side, credentials must never reach the browser, the HTTP monitoring port is unauthenticated and needs proxying, and many servers have no WebSocket listener at all. Go was chosen over TypeScript so the backend can reuse natscli's context loading and `jsm.go` rather than reimplementing them.

## Consequences

- Every new UI capability needs a backend endpoint; the frontend cannot reach NATS on its own.
- The single binary is the only way the app is distributed (GitHub Releases and `go install`). A container image was considered and dropped on 2026-10-31: one binary is all the user wants to run.
- Until the UI has its own login, the backend binds to localhost by default and every request needs the Launch token's session cookie plus an expected `Host` and `Origin`. Localhost alone does not stop other websites in the same browser (CSRF, DNS rebinding). Listening on another address is possible but prints a warning, and the token requirement still applies.
