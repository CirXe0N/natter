// Command e2eserver runs natter's real HTTP handler next to an embedded NATS
// server for the Playwright suite. It is a separate program so the shipped
// binary has no test mode. It prints one line Playwright waits for:
//
//	E2E READY url=http://127.0.0.1:PORT token=TOKEN monitoring=http://127.0.0.1:PORT
//
// Contexts live in a temp config root, so the real ~/.config/nats is never read.
package main

import (
	"context"
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

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
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
	if err := seedJetStream(ns.ClientURL()); err != nil {
		log.Fatal(err)
	}
	// A client the Connections spec can find and kick. nats.go reconnects it, so a rerun finds it again.
	victim, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"), nats.Name("orders-service"))
	if err != nil {
		log.Fatal(err)
	}
	defer victim.Close()
	if _, err := victim.SubscribeSync("orders.>"); err != nil {
		log.Fatal(err)
	}
	ctxs := contexts.New(root, vault.Open(filepath.Join(root, "natter")))
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

// seedJetStream gives the app Context one stream and one KV bucket to find.
func seedJetStream(url string) error {
	nc, err := nats.Connect(url, nats.UserInfo("app", "app"))
	if err != nil {
		return err
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		return err
	}
	ctx := context.Background()
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "ORDERS", Subjects: []string{"orders.>"}}); err != nil {
		return err
	}
	for _, subj := range []string{"orders.eu.new", "orders.eu.new", "orders.us.paid"} {
		if _, err := js.Publish(ctx, subj, []byte(`{"id":1}`)); err != nil {
			return err
		}
	}
	_, err = js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "config"})
	return err
}
