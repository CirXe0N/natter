// Package web holds the frontend. Its build output in web/dist is embedded in
// the binary. Build it first with `npm --prefix web ci && npm --prefix web run build`.
// Without a build, the committed web/dist/.gitkeep keeps the embed compiling and
// natter answers every page with how to build the UI.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist is the built frontend, with index.html at its root.
var Dist, _ = fs.Sub(dist, "dist")
