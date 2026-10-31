// Command e2eserver runs natter's real HTTP handler next to an embedded NATS
// server for the Playwright suite. It is a separate program so the shipped
// binary has no test mode. It prints one line Playwright waits for:
//
//	E2E READY url=http://127.0.0.1:PORT token=TOKEN monitoring=http://127.0.0.1:PORT
//
// Contexts live in a temp config root, so the real ~/.config/nats is never read.
package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/web"
)

func main() {
	tmp, err := os.MkdirTemp("", "natter-e2e-")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(tmp)

	ns, err := natstest.Start(tmp)
	if err != nil {
		log.Fatal(err)
	}
	defer ns.Shutdown()

	root := filepath.Join(tmp, "config")
	os.Setenv("E2E_APP_PASSWORD", "app")
	for name, fields := range map[string]map[string]string{
		"app":            {"url": ns.ClientURL(), "user": "app", "password": "env://E2E_APP_PASSWORD", "description": "APP account, with JetStream"},
		"sys":            {"url": ns.ClientURL(), "user": "sys", "password": "sys", "description": "System account"},
		"wrong-password": {"url": ns.ClientURL(), "user": "app", "password": "nope"},
	} {
		if err := natstest.WriteContext(root, name, fields); err != nil {
			log.Fatal(err)
		}
	}
	ctxs := contexts.New(root)
	defer ctxs.Close()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	token := rand.Text()
	go func() {
		srv := &http.Server{Handler: server.New(server.Config{Token: token, Port: port, UI: web.Dist, Version: "e2e", Contexts: ctxs}), ReadHeaderTimeout: 10 * time.Second}
		log.Fatal(srv.Serve(ln))
	}()
	fmt.Printf("E2E READY url=http://127.0.0.1:%d token=%s monitoring=http://%s\n", port, token, ns.MonitorAddr())

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
}
