package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/CirXe0N/natter/internal/server"
)

const (
	token  = "TESTTOKEN"
	port   = 4280
	host   = "127.0.0.1:4280"
	cookie = "natter_session_4280"
)

var ui = fstest.MapFS{
	"index.html":           {Data: []byte("<!doctype html><title>Natter</title>")},
	"assets/app-abc123.js": {Data: []byte("console.log(1)")},
}

func newHandler(allowedHosts ...string) http.Handler {
	return server.New(server.Config{Token: token, Port: port, AllowedHosts: allowedHosts, UI: ui})
}

func do(h http.Handler, method, target string, mod func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, nil)
	r.Host = host
	if mod != nil {
		mod(r)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func launch(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	w := do(h, "GET", "/launch?token="+token, nil)
	for _, c := range w.Result().Cookies() {
		if c.Name == cookie {
			return c
		}
	}
	t.Fatalf("launch set no %s cookie; status %d", cookie, w.Code)
	return nil
}

func withCookie(c *http.Cookie) func(*http.Request) {
	return func(r *http.Request) { r.AddCookie(c) }
}

func TestLaunchTokenExchange(t *testing.T) {
	h := newHandler()
	w := do(h, "GET", "/launch?token="+token, nil)

	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/" {
		t.Fatalf("got %d to %q, want 303 to /", w.Code, w.Header().Get("Location"))
	}
	if got := w.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("Referrer-Policy = %q, want no-referrer", got)
	}
	c := launch(t, h)
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.Value == "" {
		t.Errorf("cookie = %+v, want HttpOnly, SameSite=Strict, Path=/, non-empty value", c)
	}

	page := do(h, "GET", "/", withCookie(c))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "<title>Natter</title>") {
		t.Errorf("GET / with session: %d %q, want the UI index", page.Code, page.Body.String())
	}
}

func TestEachExchangeMintsAFreshSession(t *testing.T) {
	h := newHandler()
	a, b := launch(t, h), launch(t, h)
	if a.Value == b.Value {
		t.Fatal("two exchanges returned the same session id")
	}
	for _, c := range []*http.Cookie{a, b} {
		if w := do(h, "GET", "/", withCookie(c)); w.Code != http.StatusOK {
			t.Errorf("session %q: got %d, want 200", c.Value, w.Code)
		}
	}
}

func TestWrongTokenIsRefused(t *testing.T) {
	for _, target := range []string{"/launch", "/launch?token=", "/launch?token=TESTTOKEX"} {
		w := do(newHandler(), "GET", target, nil)
		if w.Code != http.StatusForbidden || len(w.Result().Cookies()) != 0 {
			t.Errorf("%s: got %d with cookies %v, want 403 and no cookie", target, w.Code, w.Result().Cookies())
		}
	}
}

func TestRequestsWithoutAValidSessionAreRefused(t *testing.T) {
	h := newHandler()
	other := newHandler()
	cases := map[string]func(*http.Request){
		"no cookie":     nil,
		"unknown id":    withCookie(&http.Cookie{Name: cookie, Value: "NOTASESSION"}),
		"other port":    withCookie(&http.Cookie{Name: "natter_session_9999", Value: launch(t, h).Value}),
		"other process": withCookie(launch(t, other)),
	}
	for name, mod := range cases {
		for _, target := range []string{"/", "/streams/ORDERS", "/assets/app-abc123.js"} {
			if w := do(h, "GET", target, mod); w.Code != http.StatusUnauthorized {
				t.Errorf("%s, GET %s: got %d, want 401", name, target, w.Code)
			}
		}
	}
}

func TestUnexpectedHostIsRefused(t *testing.T) {
	h := newHandler()
	c := launch(t, h)
	for _, badHost := range []string{"evil.example:4280", "evil.example", "localhost.evil.example:4280", "192.168.1.5:4280"} {
		setHost := func(r *http.Request) { r.Host = badHost; r.AddCookie(c) }
		if w := do(h, "GET", "/", setHost); w.Code != http.StatusMisdirectedRequest {
			t.Errorf("Host %s: got %d, want 421", badHost, w.Code)
		}
		launchFrom := func(r *http.Request) { r.Host = badHost }
		if w := do(h, "GET", "/launch?token="+token, launchFrom); w.Code != http.StatusMisdirectedRequest {
			t.Errorf("Host %s on /launch: got %d, want 421", badHost, w.Code)
		}
	}
	for _, goodHost := range []string{"127.0.0.1:4280", "localhost:4280", "LOCALHOST:4280", "[::1]:4280"} {
		setHost := func(r *http.Request) { r.Host = goodHost; r.AddCookie(c) }
		if w := do(h, "GET", "/", setHost); w.Code != http.StatusOK {
			t.Errorf("Host %s: got %d, want 200", goodHost, w.Code)
		}
	}
}

func TestAllowedHostsExtendTheAllowList(t *testing.T) {
	h := newHandler("natter.lan")
	c := launch(t, h)
	lan := func(r *http.Request) { r.Host = "natter.lan:4280"; r.AddCookie(c) }
	if w := do(h, "GET", "/", lan); w.Code != http.StatusOK {
		t.Errorf("allowed host: got %d, want 200", w.Code)
	}
	evil := func(r *http.Request) { r.Host = "evil.example:4280"; r.AddCookie(c) }
	if w := do(h, "GET", "/", evil); w.Code != http.StatusMisdirectedRequest {
		t.Errorf("unlisted host: got %d, want 421", w.Code)
	}
}

func TestCrossOriginPostIsRefused(t *testing.T) {
	h := newHandler()
	c := launch(t, h)
	cases := map[string]func(*http.Request){
		"Sec-Fetch-Site cross-site": func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		"Sec-Fetch-Site same-site":  func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "same-site") },
		"foreign Origin":            func(r *http.Request) { r.Header.Set("Origin", "http://evil.example") },
		"other localhost port":      func(r *http.Request) { r.Header.Set("Origin", "http://127.0.0.1:5173") },
		"Origin null":               func(r *http.Request) { r.Header.Set("Origin", "null") },
		"Origin null, same-origin":  func(r *http.Request) { r.Header.Set("Origin", "null"); r.Header.Set("Sec-Fetch-Site", "same-origin") },
	}
	for name, set := range cases {
		w := do(h, "POST", "/", func(r *http.Request) { r.AddCookie(c); set(r) })
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: got %d, want 403", name, w.Code)
		}
	}

	// A same-origin POST passes every check and reaches routing, where / only takes GET.
	sameOrigin := func(r *http.Request) { r.AddCookie(c); r.Header.Set("Origin", "http://"+host) }
	if w := do(h, "POST", "/", sameOrigin); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("same-origin POST: got %d, want 405 from routing", w.Code)
	}
}

func TestEmbeddedUI(t *testing.T) {
	h := newHandler()
	c := launch(t, h)
	get := func(target string) *httptest.ResponseRecorder { return do(h, "GET", target, withCookie(c)) }

	asset := get("/assets/app-abc123.js")
	if asset.Code != http.StatusOK || asset.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("hashed asset: %d, Cache-Control %q", asset.Code, asset.Header().Get("Cache-Control"))
	}

	for _, target := range []string{"/", "/streams/ORDERS"} {
		w := get(target)
		if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-cache" || !strings.Contains(w.Body.String(), "<title>Natter</title>") {
			t.Errorf("%s: %d, Cache-Control %q, want index.html with no-cache", target, w.Code, w.Header().Get("Cache-Control"))
		}
	}

	missing := get("/assets/app-old999.js")
	if missing.Code != http.StatusNotFound || strings.Contains(missing.Body.String(), "<title>") {
		t.Errorf("missing asset: %d %q, want a plain 404", missing.Code, missing.Body.String())
	}
}

func TestTrustedOriginPassesTheCrossOriginCheck(t *testing.T) {
	h := server.New(server.Config{Token: token, Port: port, UI: ui, TrustedOrigins: []string{"http://localhost:5173"}})
	c := launch(t, h)
	vite := func(r *http.Request) { r.AddCookie(c); r.Header.Set("Origin", "http://localhost:5173") }
	if w := do(h, "POST", "/", vite); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST from the trusted origin: got %d, want 405 from routing", w.Code)
	}
	other := func(r *http.Request) { r.AddCookie(c); r.Header.Set("Origin", "http://localhost:5174") }
	if w := do(h, "POST", "/", other); w.Code != http.StatusForbidden {
		t.Errorf("POST from an untrusted origin: got %d, want 403", w.Code)
	}
}

func TestInfo(t *testing.T) {
	h := server.New(server.Config{Token: token, Port: port, UI: ui, Version: "v1.2.3"})
	c := launch(t, h)
	w := do(h, "GET", "/api/info", withCookie(c))
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "application/json" || strings.TrimSpace(w.Body.String()) != `{"version":"v1.2.3"}` {
		t.Errorf("/api/info: %d %q %q", w.Code, w.Header().Get("Content-Type"), w.Body.String())
	}
	if w := do(h, "GET", "/api/info", nil); w.Code != http.StatusUnauthorized {
		t.Errorf("/api/info without a session: got %d, want 401", w.Code)
	}
}

func TestUnknownAPIPathIsNotTheSPA(t *testing.T) {
	h := newHandler()
	c := launch(t, h)
	if w := do(h, "GET", "/api/nope", withCookie(c)); w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "<title>") {
		t.Errorf("/api/nope: %d %q, want a plain 404", w.Code, w.Body.String())
	}
}

func TestBinaryWithoutUISaysHowToBuildIt(t *testing.T) {
	h := server.New(server.Config{Token: token, Port: port, UI: fstest.MapFS{".gitkeep": {}}})
	c := launch(t, h)
	if w := do(h, "GET", "/", withCookie(c)); w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), "npm --prefix web run build") {
		t.Errorf("/ with no index.html: %d %q", w.Code, w.Body.String())
	}
}
