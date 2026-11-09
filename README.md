# Natter

A local console for [NATS](https://nats.io): browse streams, consumers, messages and KV, publish, and live tail. One binary, no account, nothing leaves your machine.

For full documentation, see the [Natter docs](https://cirxe0n.github.io/natter/docs/).

## Install

Grab a binary or the desktop app from the [latest release](https://github.com/CirXe0N/natter/releases/latest), or:

```sh
go install github.com/CirXe0N/natter/cmd/natter@latest
```

## Use

```sh
natter           # serves the UI on localhost and prints a Launch token URL
natter open      # opens it in an app window, starting it if needed
```

Run `natter -h` for flags.

## Develop

```sh
npm --prefix web ci && npm --prefix web run build
go run ./cmd/natter
uvx pre-commit install   # gofmt, go vet, web lint and Conventional Commits on every commit
```

Release steps are in [docs/releasing.md](docs/releasing.md); the landing page and docs live in [site/](site/).

NATS is a trademark of the Linux Foundation. Natter is not affiliated with it.
