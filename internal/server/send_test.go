package server_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestSend(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	nc, err := nats.Connect(ns.ClientURL(), nats.UserInfo("app", "app"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nc.Close)

	published := make(chan *nats.Msg, 1)
	if _, err := nc.ChanSubscribe("pub.x", published); err != nil {
		t.Fatal(err)
	}
	bulk := make(chan *nats.Msg, 10)
	if _, err := nc.ChanSubscribe("bulk.*", bulk); err != nil {
		t.Fatal(err)
	}
	nc.Subscribe("svc.echo", func(m *nats.Msg) {
		r := nats.NewMsg(m.Reply)
		r.Data = append([]byte("echo:"), m.Data...)
		r.Header.Set("X-Seen", m.Header.Get("X-In"))
		m.RespondMsg(r)
	})
	nc.Subscribe("svc.fail", func(m *nats.Msg) {
		r := nats.NewMsg(m.Reply)
		r.Header.Set("Nats-Service-Error", "not found")
		r.Header.Set("Nats-Service-Error-Code", "404")
		m.RespondMsg(r)
	})
	nc.Subscribe("svc.silent", func(*nats.Msg) {})
	nc.Flush()

	root := t.TempDir()
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Contexts: m})
	c := launch(t, h)
	call := func(method, path, body string) *http.Response {
		t.Helper()
		w := do(h, method, path, func(r *http.Request) {
			r.AddCookie(c)
			r.Body = io.NopCloser(strings.NewReader(body))
		})
		return w.Result()
	}
	activate := func(body string) {
		t.Helper()
		if res := call("PUT", "/api/contexts/active", body); res.StatusCode != 200 {
			t.Fatalf("activate: %d", res.StatusCode)
		}
	}
	send := func(req api.SendRequest, want int) (res api.SendResult, text string) {
		t.Helper()
		b, _ := json.Marshal(req)
		r := call("POST", "/api/send", string(b))
		out, _ := io.ReadAll(r.Body)
		if r.StatusCode != want {
			t.Fatalf("send %+v: %d %s (want %d)", req, r.StatusCode, out, want)
		}
		if want == 200 {
			if err := json.Unmarshal(out, &res); err != nil {
				t.Fatal(err)
			}
		}
		return res, string(out)
	}

	// Nothing active yet.
	send(api.SendRequest{Mode: "pub", Subject: "pub.x"}, http.StatusConflict)
	activate(`{"source":"cli","name":"app"}`)

	// Publish carries headers, repeated keys included, and the payload.
	res, _ := send(api.SendRequest{Mode: "pub", Subject: "pub.x", Headers: [][2]string{{"K", "a"}, {"K", "b"}}, Payload: "hi"}, 200)
	if res.Status != api.SendStatusPublished {
		t.Fatalf("publish: %+v", res)
	}
	select {
	case got := <-published:
		if string(got.Data) != "hi" || strings.Join(got.Header.Values("K"), ",") != "a,b" {
			t.Fatalf("published %q %v", got.Data, got.Header)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("nothing published")
	}

	// A request with a responder returns its reply and a latency.
	res, _ = send(api.SendRequest{Mode: "req", Subject: "svc.echo", Headers: [][2]string{{"X-In", "yes"}}, Payload: "ping"}, 200)
	if res.Status != api.SendStatusOK || res.Reply == nil || res.Reply.Payload != "echo:ping" || res.LatencyMs <= 0 {
		t.Fatalf("request: %+v", res)
	}
	if len(res.Reply.Headers) != 1 || res.Reply.Headers[0] != [2]string{"X-Seen", "yes"} {
		t.Fatalf("reply headers: %v", res.Reply.Headers)
	}

	// A service error reply is an error, with its reply attached.
	res, _ = send(api.SendRequest{Mode: "req", Subject: "svc.fail"}, 200)
	if res.Status != api.SendStatusError || res.Reply == nil || !strings.Contains(res.Error, "not found") {
		t.Fatalf("service error: %+v", res)
	}

	// No responders, a timeout and an error are three different results.
	res, _ = send(api.SendRequest{Mode: "req", Subject: "svc.nobody"}, 200)
	if res.Status != api.SendStatusNoResponders {
		t.Fatalf("no responders: %+v", res)
	}
	start := time.Now()
	res, _ = send(api.SendRequest{Mode: "req", Subject: "svc.silent", TimeoutMs: 150}, 200)
	if res.Status != api.SendStatusTimeout || time.Since(start) < 150*time.Millisecond {
		t.Fatalf("timeout: %+v after %s", res, time.Since(start))
	}

	// Refused before sending: bad subject, bad mode, over max_payload.
	for _, req := range []api.SendRequest{
		{Mode: "pub", Subject: ""},
		{Mode: "pub", Subject: "a.>"},
		{Mode: "pub", Subject: "a b"},
		{Mode: "pub", Subject: "a", Headers: [][2]string{{"bad key", "v"}}},
		{Mode: "nope", Subject: "a"},
		{Mode: "req", Subject: "a", TimeoutMs: -1},
	} {
		send(req, http.StatusBadRequest)
	}
	max := int(nc.MaxPayload())
	_, text := send(api.SendRequest{Mode: "pub", Subject: "pub.x", Payload: strings.Repeat("x", max+1)}, http.StatusRequestEntityTooLarge)
	if !strings.Contains(text, "max_payload") {
		t.Errorf("too large: %q", text)
	}
	send(api.SendRequest{Mode: "pub", Subject: "pub.x", Payload: strings.Repeat("x", max-100)}, 200)
	if got := (<-published).Data; len(got) != max-100 {
		t.Errorf("large publish: %d bytes", len(got))
	}
	if r := call("GET", "/api/contexts/active", ""); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	} else {
		var a api.Active
		json.NewDecoder(r.Body).Decode(&a)
		if a.MaxPayload != max {
			t.Errorf("Active.MaxPayload = %d, want %d", a.MaxPayload, max)
		}
	}

	// Placeholders render per message, {{Count}} runs from 1, and a bad one in
	// the payload stays as typed. Header names are never templated.
	res, _ = send(api.SendRequest{Mode: "pub", Subject: "bulk.{{Count}}", Count: 3, Payload: "n={{ Count }}", Headers: [][2]string{{"X-N", "{{Count}}"}}}, 200)
	if res.Status != api.SendStatusPublished || res.Sent != 3 {
		t.Fatalf("bulk publish: %+v", res)
	}
	for i := 1; i <= 3; i++ {
		got := <-bulk
		if got.Subject != fmt.Sprintf("bulk.%d", i) || string(got.Data) != fmt.Sprintf("n=%d", i) || got.Header.Get("X-N") != fmt.Sprint(i) {
			t.Fatalf("message %d: %s %q %v", i, got.Subject, got.Data, got.Header)
		}
	}
	res, _ = send(api.SendRequest{Mode: "req", Subject: "svc.echo", Count: 2, Payload: "{{Count}}"}, 200)
	if res.Status != api.SendStatusOK || res.Sent != 2 || res.Reply.Payload != "echo:2" {
		t.Fatalf("bulk request: %+v", res)
	}
	send(api.SendRequest{Mode: "pub", Subject: "bulk.x", Headers: [][2]string{{"X", "{{Foo}}"}}}, http.StatusBadRequest)
	send(api.SendRequest{Mode: "pub", Subject: "bulk.x", Count: 10001}, http.StatusBadRequest)

	// Read-only mode blocks a publish and a request alike.
	if r := call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	for _, mode := range []api.SendMode{"pub", "req"} {
		send(api.SendRequest{Mode: mode, Subject: "svc.echo"}, http.StatusForbidden)
		send(api.SendRequest{Mode: mode, Subject: "svc.echo", Count: 5}, http.StatusForbidden)
	}

	// The preview sends nothing, so Read-only mode lets it through.
	pr := call("POST", "/api/send/preview", `{"subject":"a.{{Count}}","headers":[["X","{{Bogus}}"],["Y"," v{{Count}} "]],"payload":"{{Count"}`)
	var prev api.SendPreview
	if pr.StatusCode != 200 || json.NewDecoder(pr.Body).Decode(&prev) != nil {
		t.Fatalf("preview: %d", pr.StatusCode)
	}
	if prev.Subject != "a.1" || prev.SubjectError != "" || prev.Payload != "{{Count" || prev.PayloadError == "" ||
		prev.Headers[0][1] != "{{Bogus}}" || prev.HeaderErrors[0] == "" || prev.Headers[1][1] != "v1" || prev.HeaderErrors[1] != "" {
		t.Errorf("preview: %+v", prev)
	}
}
