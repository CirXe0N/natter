// Package web holds the frontend. Its build output in web/dist is embedded in
// the binary. A committed placeholder index.html keeps a fresh clone compiling.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist is the built frontend, with index.html at its root.
var Dist, _ = fs.Sub(dist, "dist")
