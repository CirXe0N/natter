package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/natstest"
	"github.com/CirXe0N/natter/internal/vault"
)

func TestExamplesRoundTripAndReadOnly(t *testing.T) {
	ns, err := natstest.Start(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ns.Shutdown)
	root := t.TempDir() // never the real config dir
	if err := natstest.WriteContext(root, "app", map[string]string{"url": ns.ClientURL(), "user": "app", "password": "app"}); err != nil {
		t.Fatal(err)
	}
	m := contexts.New(root, vault.Open(t.TempDir()))
	t.Cleanup(m.Close)
	h := New(Config{Token: "tok", Port: 1, UI: fstest.MapFS{}, Contexts: m})

	var session *http.Cookie
	call := func(method, target, body string) (int, string) {
		r := httptest.NewRequest(method, target, strings.NewReader(body))
		r.Host = "localhost"
		if session != nil {
			r.AddCookie(session)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if c := w.Result().Cookies(); len(c) > 0 {
			session = c[0]
		}
		return w.Code, w.Body.String()
	}
	call("GET", "/launch?token=tok", "")
	call("PUT", "/api/contexts/active", `{"source":"cli","name":"app"}`)
	call("PUT", "/api/contexts/cli/app/settings", `{"readOnly":true}`)

	code, body := call("POST", "/api/examples", `{"context":"app","name":"hello","folder":"f","mode":"req","subject":"a.{{n}}","headers":[["K","v"]],"payload":"{{x}}","timeoutMs":500}`)
	if code != 200 {
		t.Fatalf("create under Read-only: %d %s", code, body)
	}
	var e api.Example
	json.Unmarshal([]byte(body), &e)
	if code, _ := call("POST", "/api/examples", `{"context":"app","name":"hello","folder":"f","mode":"pub","subject":"x"}`); code != 409 {
		t.Errorf("duplicate: %d", code)
	}
	e.Name = "renamed"
	b, _ := json.Marshal(e)
	if code, body := call("PUT", "/api/examples/"+e.ID, string(b)); code != 200 || !strings.Contains(body, "renamed") {
		t.Errorf("rename: %d %s", code, body)
	}
	if _, body := call("GET", "/api/examples", ""); !strings.Contains(body, `"payload":"{{x}}"`) {
		t.Errorf("list: %s", body)
	}
	if code, body := call("POST", "/api/examples/copy", `{"ids":["`+e.ID+`"],"context":"other","choices":{}}`); code != 200 || !strings.Contains(body, `"other"`) {
		t.Errorf("copy: %d %s", code, body)
	}
	if code, _ := call("POST", "/api/send", `{"mode":"pub","subject":"a.b"}`); code != 403 {
		t.Errorf("resend under Read-only: %d", code)
	}
	if code, _ := call("DELETE", "/api/examples/"+e.ID, ""); code != 200 {
		t.Errorf("delete: %d", code)
	}
	if code, _ := call("DELETE", "/api/examples/"+e.ID, ""); code != 404 {
		t.Errorf("delete again: %d", code)
	}
}
