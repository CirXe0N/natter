// Package server is Natter's HTTP front door: the Launch token exchange, the
// session, Host and cross-origin checks from ADR-0001, and the embedded UI.
package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"io/fs"
	"net"
	"net/http"
	"net/netip"
	"path"
	"strconv"
	"strings"
	"sync"

	"github.com/CirXe0N/natter/internal/api"
	"github.com/CirXe0N/natter/internal/contexts"
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
	// TrustedOrigins pass the cross-origin check besides the server's own
	// origin. -dev adds the Vite dev server so it can proxy /api and /ws.
	TrustedOrigins []string
	// Version is reported by GET /api/info.
	Version string
	// Contexts lists the Contexts and holds the connection to the active one.
	Contexts *contexts.Manager
}

// route is one API endpoint. Each feature file appends its routes in init(),
// so features built in parallel never edit the same lines of New.
type route struct {
	pattern string
	handle  func(*server, http.ResponseWriter, *http.Request)
}

var routes []route

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
	mux.HandleFunc("GET /api/", http.NotFound) // unknown API paths must not get index.html
	mux.HandleFunc("GET /api/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, api.Info{Version: s.Version})
	})
	for _, rt := range routes {
		mux.HandleFunc(rt.pattern, func(w http.ResponseWriter, r *http.Request) { rt.handle(s, w, r) })
	}

	return s.checkHost(s.checkSession(s.checkOrigin(mux)))
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

func (s *server) checkOrigin(next http.Handler) http.Handler {
	cop := http.NewCrossOriginProtection()
	for _, o := range s.TrustedOrigins {
		if err := cop.AddTrustedOrigin(o); err != nil {
			panic(err) // a malformed constant in the caller, not user input
		}
	}
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
		if _, err := fs.Stat(s.UI, "index.html"); err != nil {
			http.Error(w, "This natter binary was built without its UI. Run `npm --prefix web ci && npm --prefix web run build`, then build natter again.", http.StatusNotFound)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, s.UI, "index.html")
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
