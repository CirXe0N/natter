package main

import "runtime/debug"

// version is set by GoReleaser with -X main.version. A go install or plain
// go build leaves it empty, and the build info supplies the module version.
var version string

func buildVersion(ldflag string, bi *debug.BuildInfo) string {
	if ldflag != "" {
		return ldflag
	}
	if bi != nil && bi.Main.Version != "" {
		return bi.Main.Version
	}
	return "(unknown)"
}
