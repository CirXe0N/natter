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
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/CirXe0N/natter/internal/atomicfile"
	"github.com/CirXe0N/natter/internal/contexts"
	"github.com/CirXe0N/natter/internal/server"
	"github.com/CirXe0N/natter/internal/vault"
	"github.com/CirXe0N/natter/web"
)

const defaultPort = 4280

// viteOrigin is where `npm --prefix web run dev` serves the UI. Its config
// proxies /launch, /api and /ws to defaultPort.
const viteOrigin = "http://localhost:5173"

const usage = `Usage:
  natter [flags]             serve Natter and print its Launch token URL
  natter open [flags]        open Natter in an app window, starting it if it is not running
  natter install-desktop     add Natter to the app launcher, running natter open
  natter uninstall-desktop   remove it again
`

func main() {
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "", "open":
	case "install-desktop", "uninstall-desktop":
		if err := desktop(cmd == "install-desktop"); err != nil {
			fail(err)
		}
		return
	default:
		fmt.Fprintf(os.Stderr, "natter: unknown command %q\n\n%s", cmd, usage)
		os.Exit(2)
	}

	bind := flag.String("bind", "127.0.0.1", "address to listen on")
	port := flag.Int("port", defaultPort, "port to listen on; if the default port is taken, a free one is used")
	var allowedHosts []string
	flag.Func("allowed-host", "hostname the browser may use besides localhost (repeatable); required when -bind is not a loopback address", func(h string) error {
		allowedHosts = append(allowedHosts, h)
		return nil
	})
	dev := flag.Bool("dev", false, "trust the Vite dev server at "+viteOrigin+" and print the Launch token URL through it")
	// Only ever a flag: an environment variable would be inherited by every child process.
	vaultKey := flag.String("vault-key", "", "age identity file that unlocks the Vault (create one with `age-keygen -pq -o natter.key`); a new Vault is encrypted to it")
	redirect := flag.Bool("redirect-file", false, "with open: give the browser a file that redirects to the Launch token URL, so the token is not on its command line")
	flag.Usage = func() {
		fmt.Fprint(os.Stderr, usage, "\nFlags:\n")
		flag.PrintDefaults()
	}
	flag.CommandLine.Parse(args)
	portSet := *dev // the Vite proxy targets the default port, so never fall back
	flag.Visit(func(f *flag.Flag) { portSet = portSet || f.Name == "port" })

	var open func(launchURL string) error
	if cmd == "open" {
		detachConsole()
		root, err := contexts.DefaultConfigRoot()
		if err != nil {
			fail(err)
		}
		open = func(u string) error { return openApp(u, *redirect, filepath.Join(root, "natter")) }
		if u := runningServer(launchURLFile(root)); u != "" {
			if err := open(u); err != nil {
				fail(err)
			}
			fmt.Println("Natter is already running. Opening it.")
			return
		}
	}
	if err := run(*bind, *port, portSet, allowedHosts, *dev, *vaultKey, open); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "natter:", err)
	os.Exit(1)
}

// run serves Natter. With open set, it hands open the Launch token URL
// instead of printing it.
func run(bind string, port int, portSet bool, allowedHosts []string, dev bool, vaultKey string, open func(launchURL string) error) error {
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
	launchURL := origin + "/launch?token=" + token
	if open == nil {
		fmt.Printf("Natter is running. Open this URL in your browser:\n\n  %s\n\n", launchURL)
	} else {
		fmt.Printf("Natter is running on %s.\n", origin)
	}

	root, err := contexts.DefaultConfigRoot()
	if err != nil {
		return err
	}
	// Whole-file replace, no Lock: the newest natter owns the file, and a
	// natter open that reads a stale one probes it and starts its own.
	if err := atomicfile.Write(launchURLFile(root), []byte(launchURL+"\n")); err != nil {
		return err
	}
	v := vault.Open(filepath.Join(root, "natter"))
	if vaultKey != "" {
		if err := v.UnlockKeyFile(vaultKey); err != nil {
			return fmt.Errorf("unlocking the Vault: %w", err)
		}
	}
	// One budget for the probe and the canary: a keyring that never answers
	// delays startup by at most this, then the Vault falls back to the passphrase.
	kctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	k, err := vault.OSKeyring(kctx)
	if err == nil {
		err = v.AttachKeyring(kctx, k)
	}
	cancel()
	if err != nil {
		fmt.Fprintln(os.Stderr, "natter: not using the OS keyring for the Vault key:", err)
	}
	ctxs := contexts.New(root, v)
	go func() {
		if err := ctxs.Restore(context.Background()); err != nil {
			fmt.Fprintln(os.Stderr, "natter: reconnecting to the last active Context:", err)
		}
	}()

	bi, _ := debug.ReadBuildInfo()
	version := buildVersion(version, bi)
	srv := &http.Server{
		Handler:           server.New(server.Config{Token: token, Port: port, AllowedHosts: allowedHosts, UI: web.Dist, TrustedOrigins: trusted, Version: version, Contexts: ctxs}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if open != nil {
		if err := open(launchURL); err != nil {
			fmt.Fprintln(os.Stderr, "natter: opening a browser:", err)
		}
	}
	return srv.Serve(ln)
}

// desktop adds or removes the launcher entry for this binary.
func desktop(install bool) error {
	if !install {
		return uninstallDesktop()
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := installDesktop(exe); err != nil {
		return err
	}
	fmt.Println("Added Natter to the app launcher. It runs:", exe, "open")
	return nil
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
