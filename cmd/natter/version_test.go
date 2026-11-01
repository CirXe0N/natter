package main

import (
	"runtime/debug"
	"testing"
)

func TestBuildVersionPrefersTheLdflagThenBuildInfo(t *testing.T) {
	bi := &debug.BuildInfo{Main: debug.Module{Version: "v1.2.3"}}
	for _, c := range []struct {
		flag string
		bi   *debug.BuildInfo
		want string
	}{
		{"0.9.0", bi, "0.9.0"},
		{"", bi, "v1.2.3"},
		{"", &debug.BuildInfo{}, "(unknown)"},
		{"", nil, "(unknown)"},
	} {
		if got := buildVersion(c.flag, c.bi); got != c.want {
			t.Errorf("buildVersion(%q, %v) = %q, want %q", c.flag, c.bi, got, c.want)
		}
	}
}
