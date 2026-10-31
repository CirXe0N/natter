// Command natter serves Natter, a UI for NATS™, on localhost.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/web"
)

const defaultPort = 4280

// viteOrigin is where `npm --prefix web run dev` serves the UI. Its config
// proxies /launch, /api and /ws to defaultPort.
const viteOrigin = "http://localhost:5173"

func main() {
	bind := flag.String("bind", "127.0.0.1", "address to listen on")
	port := flag.Int("port", defaultPort, "port to listen on; if the default port is taken, a free one is used")
	var allowedHosts []string
	flag.Func("allowed-host", "hostname the browser may use besides localhost (repeatable); required when -bind is not a loopback address", func(h string) error {
		allowedHosts = append(allowedHosts, h)
		return nil
	})
	dev := flag.Bool("dev", false, "trust the Vite dev server at "+viteOrigin+" and print the Launch token URL through it")
	flag.Parse()
	portSet := *dev // the Vite proxy targets the default port, so never fall back
	flag.Visit(func(f *flag.Flag) { portSet = portSet || f.Name == "port" })

	if err := run(*bind, *port, portSet, allowedHosts, *dev); err != nil {
		fmt.Fprintln(os.Stderr, "natter:", err)
		os.Exit(1)
	}
}

func run(bind string, port int, portSet bool, allowedHosts []string, dev bool) error {
	ip, ipErr := netip.ParseAddr(strings.Trim(bind, "[]"))
	loopback := bind == "localhost" || (ipErr == nil && ip.IsLoopback())
	if !loopback && len(allowedHosts) == 0 {
		return errors.New("listening on a non-loopback address needs at least one -allowed-host, the hostname browsers will use to reach Natter")
	}

	ln, err := listen(bind, port, portSet)
	if err != nil {
		return err
	}
	port = ln.Addr().(*net.TCPAddr).Port

	if !loopback {
		fmt.Fprintf(os.Stderr, "WARNING: listening on %s. Anyone who can reach this address and has the Launch token can use Natter and its NATS credentials.\n", ln.Addr())
	}
	urlHost := bind
	if bind == "" || (ipErr == nil && ip.IsUnspecified()) {
		urlHost = "127.0.0.1"
	}
	token := rand.Text()
	origin := "http://" + net.JoinHostPort(strings.Trim(urlHost, "[]"), strconv.Itoa(port))
	var trusted []string
	if dev {
		origin, trusted = viteOrigin, []string{viteOrigin}
	}
	fmt.Printf("Natter is running. Open this URL in your browser:\n\n  %s/launch?token=%s\n\n", origin, token)

	root, err := contexts.DefaultConfigRoot()
	if err != nil {
		return err
	}
	ctxs := contexts.New(root)
	go func() {
		if err := ctxs.Restore(context.Background()); err != nil {
			fmt.Fprintln(os.Stderr, "natter: reconnecting to the last active Context:", err)
		}
	}()

	version := "(unknown)"
	if bi, ok := debug.ReadBuildInfo(); ok {
		version = bi.Main.Version
	}
	srv := &http.Server{
		Handler:           server.New(server.Config{Token: token, Port: port, AllowedHosts: allowedHosts, UI: web.Dist, TrustedOrigins: trusted, Version: version, Contexts: ctxs}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return srv.Serve(ln)
}

// listen binds to bind:port. When the port was not chosen explicitly and is
// taken, it falls back to a free port so a second natter still starts.
func listen(bind string, port int, portSet bool) (net.Listener, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(strings.Trim(bind, "[]"), strconv.Itoa(port)))
	if err != nil && !portSet {
		ln, err = net.Listen("tcp", net.JoinHostPort(strings.Trim(bind, "[]"), "0"))
	}
	return ln, err
}
