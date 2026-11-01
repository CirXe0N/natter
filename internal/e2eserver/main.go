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
	if err := seedSessions(ns.ClientURL()); err != nil {
		log.Fatal(err)
	}
	if err := seedBlobs(ns.ClientURL()); err != nil {
		log.Fatal(err)
	}
	if err := seedJobs(ns.ClientURL()); err != nil {
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
	// The Publish spec's responder, and a subscriber that never replies. They get
	// their own client so the Connections spec still sees one subscription on orders-service.
	svc, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"), nats.Name("publish-spec"))
	if err != nil {
		log.Fatal(err)
	}
	defer svc.Close()
	if _, err := svc.SubscribeSync("e2e.silent"); err != nil {
		log.Fatal(err)
	}
	if _, err := svc.Subscribe("e2e.echo", func(m *nats.Msg) { _ = m.Respond(append([]byte("echo:"), m.Data...)) }); err != nil {
		log.Fatal(err)
	}
	// Traffic for the Live tail spec: ten messages a second on e2e.tail.*.
	traffic, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"), nats.Name("e2e-traffic"))
	if err != nil {
		log.Fatal(err)
	}
	defer traffic.Close()
	go func() {
		for n := 0; ; n++ {
			traffic.Publish(fmt.Sprintf("e2e.tail.%d", n%3), fmt.Appendf(nil, `{"n":%d}`, n))
			time.Sleep(100 * time.Millisecond)
		}
	}()
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
	for _, c := range []jetstream.ConsumerConfig{
		{Durable: "billing", AckPolicy: jetstream.AckExplicitPolicy, FilterSubject: "orders.eu.>"},
		{Durable: "shipping", AckPolicy: jetstream.AckExplicitPolicy},
		{Name: "natter_browse_e2e", AckPolicy: jetstream.AckNonePolicy, InactiveThreshold: 24 * time.Hour},
	} {
		if _, err := js.CreateOrUpdateConsumer(ctx, "ORDERS", c); err != nil {
			return err
		}
	}
	if _, err = js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "config"}); err != nil {
		return err
	}
	return seedEvents(ctx, js)
}

// seedEvents makes EVENTS: 200,000 messages, more rows than the message
// table's track holds unscaled, with gaps where 5 and 101-150 were deleted.
// 3 is binary and 7 is too large for a preview.
func seedEvents(ctx context.Context, js jetstream.JetStream) error {
	st, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "EVENTS", Subjects: []string{"events.>"}, Storage: jetstream.MemoryStorage})
	if err != nil {
		return err
	}
	for i := 1; i <= 200_000; i++ {
		data := fmt.Appendf(nil, `{"n":%d}`, i)
		switch i {
		case 3:
			data = []byte{0, 1, 2}
		case 7:
			data = make([]byte, 64*1024)
		}
		if _, err := js.PublishAsync([]string{"events.a", "events.b"}[i%2], data); err != nil {
			return err
		}
	}
	<-js.PublishAsyncComplete()
	for seq := uint64(101); seq <= 150; seq++ {
		if err := st.DeleteMsg(ctx, seq); err != nil {
			return err
		}
	}
	return st.DeleteMsg(ctx, 5)
}

// seedSessions makes the KV bucket sessions: user.1 with three revisions,
// and a writer that keeps changing it, so the KV spec sees live changes
// the UI did not make. clock is put every 300 ms; blink is put
// and deleted in turn every 700 ms.
func seedSessions(url string) error {
	nc, err := nats.Connect(url, nats.UserInfo("app", "app"))
	if err != nil {
		return err
	}
	js, err := jetstream.New(nc)
	if err != nil {
		return err
	}
	ctx := context.Background()
	kv, err := js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "sessions", History: 5})
	if err != nil {
		return err
	}
	for _, v := range []string{"v1", "v2", `{"user":1,"cart":3}`} {
		if _, err := kv.PutString(ctx, "user.1", v); err != nil {
			return err
		}
	}
	go func() {
		clock, blink := time.NewTicker(300*time.Millisecond), time.NewTicker(700*time.Millisecond)
		on := false
		for {
			select {
			case t := <-clock.C:
				kv.PutString(ctx, "clock", t.UTC().Format(time.TimeOnly))
			case <-blink.C:
				if on = !on; on {
					kv.PutString(ctx, "blink", "on")
				} else {
					kv.Delete(ctx, "blink")
				}
			}
		}
	}()
	return nil
}

// seedBlobs makes BLOBS for opening messages: 1 is 4 MB of JSON with a
// header, 2 is 4 MB of binary, and 3 to 12 are small ones to delete.
func seedBlobs(url string) error {
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
	if _, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "BLOBS", Subjects: []string{"blobs.>"}, AllowDirect: true}); err != nil {
		return err
	}
	doc := []byte(`{"items":[`)
	for i := 0; len(doc) < 4<<20-100; i++ {
		doc = fmt.Appendf(doc, `{"id":%d,"name":"item-%d","tags":["a","b"]},`, i, i)
	}
	doc = append(doc[:len(doc)-1], `],"end":true}`...)
	bin := make([]byte, 4<<20)
	for i := range bin {
		bin[i] = byte(i)
	}
	m := nats.NewMsg("blobs.json")
	m.Header.Set("Content-Type", "application/json")
	m.Data = doc
	if _, err := js.PublishMsg(ctx, m); err != nil {
		return err
	}
	if _, err := js.Publish(ctx, "blobs.bin", bin); err != nil {
		return err
	}
	for i := 3; i <= 12; i++ {
		if _, err := js.Publish(ctx, "blobs.small", fmt.Appendf(nil, "small %d", i)); err != nil {
			return err
		}
	}
	return nil
}

// seedJobs makes JOBS, a WorkQueue stream the message table lists with Direct
// Get: 250 messages with 120 deleted.
func seedJobs(url string) error {
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
	st, err := js.CreateStream(ctx, jetstream.StreamConfig{Name: "JOBS", Subjects: []string{"jobs.>"}, Retention: jetstream.WorkQueuePolicy, AllowDirect: true})
	if err != nil {
		return err
	}
	for i := 1; i <= 250; i++ {
		if _, err := js.Publish(ctx, "jobs.new", fmt.Appendf(nil, `{"job":%d}`, i)); err != nil {
			return err
		}
	}
	return st.DeleteMsg(ctx, 120)
}
