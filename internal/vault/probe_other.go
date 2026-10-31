//go:build !linux

package vault

import "context"

// probe has nothing to check: go-keyring uses /usr/bin/security on macOS and
// wincred on Windows, and the canary in AttachKeyring tests them.
func probe(context.Context) error { return nil }
