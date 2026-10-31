// Command e2eserver runs natter's real HTTP handler next to an embedded NATS
// server for the Playwright suite. It is a separate program so the shipped
// binary has no test mode. It prints one line Playwright waits for:
//
//	E2E READY url=http://127.0.0.1:PORT token=TOKEN
package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"

	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/web"
)

func main() {
	store, err := os.MkdirTemp("", "natter-e2e-")
	if err != nil {
		log.Fatal(err)
	}
	defer os.RemoveAll(store)

	ns, err := natsserver.NewServer(&natsserver.Options{Host: "127.0.0.1", Port: -1, JetStream: true, StoreDir: store, NoSigs: true})
	if err != nil {
		log.Fatal(err)
	}
	go ns.Start()
	if !ns.ReadyForConnections(10 * time.Second) {
		log.Fatal("embedded NATS server did not start")
	}
	defer ns.Shutdown()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	token := rand.Text()
	go func() {
		srv := &http.Server{Handler: server.New(server.Config{Token: token, Port: port, UI: web.Dist, Version: "e2e"}), ReadHeaderTimeout: 10 * time.Second}
		log.Fatal(srv.Serve(ln))
	}()
	fmt.Printf("E2E READY url=http://127.0.0.1:%d token=%s\n", port, token)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
}
