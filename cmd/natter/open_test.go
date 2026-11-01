package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/CirXe0N/natter/internal/server"
)

func TestRunningServerAttachesOnlyWithAWorkingLaunchURL(t *testing.T) {
	srv := httptest.NewServer(server.New(server.Config{Token: "right"}))
	defer srv.Close()
	file := filepath.Join(t.TempDir(), "launch-url")

	if got := runningServer(file); got != "" {
		t.Errorf("no file: got %q, want no server", got)
	}

	good := srv.URL + "/launch?token=right"
	os.WriteFile(file, []byte(good+"\n"), 0o600)
	if got := runningServer(file); got != good {
		t.Errorf("live server: got %q, want %q", got, good)
	}

	os.WriteFile(file, []byte(srv.URL+"/launch?token=stale"), 0o600)
	if got := runningServer(file); got != "" {
		t.Errorf("another server on the port: got %q, want no server", got)
	}

	srv.Close()
	os.WriteFile(file, []byte(good), 0o600)
	if got := runningServer(file); got != "" {
		t.Errorf("server gone: got %q, want no server", got)
	}
}

func TestFindBrowserLooksUpChromiumFamilyOnPath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	if got := findBrowser(); got != "" {
		t.Errorf("empty PATH: got %q, want none so the default browser opens", got)
	}
	brave := filepath.Join(dir, "brave")
	os.WriteFile(brave, []byte("#!/bin/sh\n"), 0o755)
	if got := findBrowser(); got != brave {
		t.Errorf("got %q, want %q", got, brave)
	}
}

func TestRedirectFileKeepsTheTokenOutOfTheURL(t *testing.T) {
	dir := t.TempDir()
	launch := "http://127.0.0.1:4280/launch?token=ABC&x=<y>"
	u, err := writeRedirectFile(dir, launch)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(u, "ABC") || !strings.HasPrefix(u, "file:///") {
		t.Errorf("redirect URL = %q, want a file:// URL without the token", u)
	}
	p := filepath.Join(dir, "open.html")
	b, _ := os.ReadFile(p)
	if !strings.Contains(string(b), `url=http://127.0.0.1:4280/launch?token=ABC&amp;x=&lt;y&gt;"`) {
		t.Errorf("redirect file does not refresh to the escaped launch URL:\n%s", b)
	}
	if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
		t.Errorf("mode = %v, want 0600: it holds the token", st.Mode().Perm())
	}
}
