// Command natter serves Natter, a UI for NATS™, on localhost.
package main

import (
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/web"
)

const defaultPort = 4280

func main() {
	bind := flag.String("bind", "127.0.0.1", "address to listen on")
	port := flag.Int("port", defaultPort, "port to listen on; if the default port is taken, a free one is used")
	var allowedHosts []string
	flag.Func("allowed-host", "hostname the browser may use besides localhost (repeatable); required when -bind is not a loopback address", func(h string) error {
		allowedHosts = append(allowedHosts, h)
		return nil
	})
	flag.Parse()
	portSet := false
	flag.Visit(func(f *flag.Flag) { portSet = portSet || f.Name == "port" })

	if err := run(*bind, *port, portSet, allowedHosts); err != nil {
		fmt.Fprintln(os.Stderr, "natter:", err)
		os.Exit(1)
	}
}

func run(bind string, port int, portSet bool, allowedHosts []string) error {
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
	fmt.Printf("Natter is running. Open this URL in your browser:\n\n  http://%s/launch?token=%s\n\n", net.JoinHostPort(strings.Trim(urlHost, "[]"), strconv.Itoa(port)), token)

	srv := &http.Server{
		Handler:           server.New(server.Config{Token: token, Port: port, AllowedHosts: allowedHosts, UI: web.Dist}),
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
