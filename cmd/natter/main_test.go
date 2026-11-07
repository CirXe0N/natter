package main

import (
	"io"
	"net"
	"os"
	"strings"
	"testing"
)

func TestListenFallsBackOnlyForTheDefaultPort(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	port := taken.Addr().(*net.TCPAddr).Port

	ln, err := listen("127.0.0.1", port, false)
	if err != nil {
		t.Fatalf("default port taken: got %v, want a fallback port", err)
	}
	defer ln.Close()
	if got := ln.Addr().(*net.TCPAddr).Port; got == port || got == 0 {
		t.Errorf("fallback port = %d, want a free port other than %d", got, port)
	}

	if ln, err := listen("127.0.0.1", port, true); err == nil {
		ln.Close()
		t.Error("explicit port taken: got a listener, want an error")
	}
}

func TestNonLoopbackBindNeedsAllowedHost(t *testing.T) {
	for _, bind := range []string{"0.0.0.0", "", "::", "192.168.1.5"} {
		if err := run(bind, 0, true, nil, false, "", nil); err == nil {
			t.Errorf("bind %q without -allowed-host: got no error", bind)
		}
	}
}

func captureStdout(t *testing.T, f func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdout
	os.Stdout = w
	defer func() { os.Stdout = old }()
	f()
	w.Close()
	b, _ := io.ReadAll(r)
	return string(b)
}

func TestDesktopBuildInstallDesktopWritesNothing(t *testing.T) {
	data := t.TempDir()
	t.Setenv("XDG_DATA_HOME", data)
	t.Setenv("HOME", data)
	t.Setenv("APPDATA", data)
	t.Setenv("LOCALAPPDATA", data)
	old := windowApp
	windowApp = func(string) error { return nil }
	t.Cleanup(func() { windowApp = old })

	var err error
	out := captureStdout(t, func() { err = desktop(true) })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "own launcher entry") {
		t.Errorf("output = %q, want it to say the app has its own launcher entry", out)
	}
	if left, _ := os.ReadDir(data); len(left) != 0 {
		t.Errorf("install-desktop wrote %v", left)
	}
}
