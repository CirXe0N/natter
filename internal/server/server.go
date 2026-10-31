// Package server is Natter's HTTP front door: the Launch token exchange, the
// session, Host and cross-origin checks from ADR-0001, and the embedded UI.
package server

import (
	"crypto/rand"
	"crypto/subtle"
	"io/fs"
	"net"
	"net/http"
	"net/netip"
	"path"
	"strconv"
	"strings"
	"sync"
)

type Config struct {
	// Token is the Launch token a browser trades at /launch for a session.
	Token string
	// Port is the port the server listens on. It names the session cookie,
	// because cookies are not isolated by port (RFC 6265 §8.5).
	Port int
	// AllowedHosts are hostnames accepted in the Host header besides
	// localhost and loopback IPs. Needed only for a non-loopback bind.
	AllowedHosts []string
	// UI is the built frontend, with index.html at its root.
	UI fs.FS
}

type server struct {
	Config
	cookie   string
	allowed  map[string]bool
	sessions sync.Map // session id -> struct{}
}

// New returns the whole HTTP handler. Requests pass, in order, a Host
// allow-list, a session check and a cross-origin check before routing.
//
// No GET route may change state: the cross-origin check only covers unsafe
// methods. /launch is the one exception, and it needs the Launch token.
func New(c Config) http.Handler {
	s := &server{Config: c, cookie: "natter_session_" + strconv.Itoa(c.Port), allowed: map[string]bool{}}
	for _, h := range c.AllowedHosts {
		s.allowed[strings.ToLower(h)] = true
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /launch", s.launch)
	mux.Handle("GET /", s.ui())

	return s.checkHost(s.checkSession(checkOrigin(mux)))
}

func (s *server) checkHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		host = strings.ToLower(strings.Trim(host, "[]"))
		ip, err := netip.ParseAddr(host)
		if host != "localhost" && !(err == nil && ip.IsLoopback()) && !s.allowed[host] {
			http.Error(w, "unexpected Host header", http.StatusMisdirectedRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) checkSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/launch" {
			id := ""
			if c, err := r.Cookie(s.cookie); err == nil {
				id = c.Value
			}
			if _, ok := s.sessions.Load(id); !ok {
				http.Error(w, "No session. Open the Launch token URL that natter printed in its terminal.", http.StatusUnauthorized)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func checkOrigin(next http.Handler) http.Handler {
	cop := http.NewCrossOriginProtection()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		safe := r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS"
		if !safe && (r.Header.Get("Origin") == "null" || cop.Check(r) != nil) {
			http.Error(w, "cross-origin request refused", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) launch(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("token")), []byte(s.Token)) != 1 {
		http.Error(w, "invalid Launch token", http.StatusForbidden)
		return
	}
	id := rand.Text()
	s.sessions.Store(id, struct{}{})
	http.SetCookie(w, &http.Cookie{Name: s.cookie, Value: id, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// ui serves real files from the build, hashed assets/ as immutable, and
// index.html for any other path so client-side routes work. A missing asset is
// a real 404, so a stale tab gets an error instead of HTML for a JS chunk.
func (s *server) ui() http.Handler {
	files := http.FileServerFS(s.UI)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		isAsset := strings.HasPrefix(p, "assets/")
		if st, err := fs.Stat(s.UI, p); err == nil && !st.IsDir() && p != "index.html" {
			if isAsset {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			files.ServeHTTP(w, r)
			return
		}
		if isAsset {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, s.UI, "index.html")
	})
}
