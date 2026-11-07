package main

import (
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestServeInBackgroundHandsOverTheLaunchURL(t *testing.T) {
	stop := make(chan struct{})
	defer close(stop)
	u, errc, err := serveInBackground(func(open func(string) error) error {
		open("http://127.0.0.1:1234/launch?token=T")
		<-stop
		return nil
	})
	if err != nil || u != "http://127.0.0.1:1234/launch?token=T" {
		t.Fatalf("got %q, %v; want the URL run passed to open", u, err)
	}
	select {
	case err := <-errc:
		t.Fatalf("server still running, but errc gave %v", err)
	default:
	}
}

func TestServeInBackgroundReportsAStartupFailure(t *testing.T) {
	want := errors.New("port taken")
	if _, _, err := serveInBackground(func(func(string) error) error { return want }); !errors.Is(err, want) {
		t.Fatalf("got %v, want %v", err, want)
	}
}

// Only the desktop build tag may pull in Wails and, with it, cgo.
func TestDefaultBuildHasNoWails(t *testing.T) {
	if testing.Short() {
		t.Skip("runs go list")
	}
	cmd := exec.Command("go", "list", "-deps", "-f", "{{.ImportPath}}", ".")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go list: %v\n%s", err, out)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "wailsapp") {
			t.Errorf("default build depends on %q", line)
		}
	}
}
