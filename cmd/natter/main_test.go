package main

import (
	"net"
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
		if err := run(bind, 0, true, nil, false); err == nil {
			t.Errorf("bind %q without -allowed-host: got no error", bind)
		}
	}
}
