// Package api holds the JSON shapes the backend sends to the browser.
// tygo turns them into web/src/gen/api.ts, so the frontend cannot drift from Go.
package api

//go:generate go tool tygo generate

// Info describes the running natter binary.
type Info struct {
	Version string `json:"version"`
}
