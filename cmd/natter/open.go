package main

import (
	"html"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/CirXe0N/natter/internal/atomicfile"
)

// launchURLFile is where a running natter keeps its Launch token URL, so
// natter open can attach to it. It lives in natter's own 0700 directory.
func launchURLFile(root string) string { return filepath.Join(root, "natter", "launch-url") }

// runningServer returns the Launch token URL in file if a natter still
// answers it, and "" if the file is missing or stale.
func runningServer(file string) string {
	b, err := os.ReadFile(file)
	if err != nil {
		return ""
	}
	u := strings.TrimSpace(string(b))
	c := http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	// Only the right token gets the 303. The probe's session is never used.
	resp, err := c.Get(u)
	if err != nil {
		return ""
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		return ""
	}
	return u
}

// findBrowser returns the first Chromium-family browser in this OS's usual
// places, or "" if there is none.
func findBrowser() string {
	switch runtime.GOOS {
	case "windows":
		for _, dir := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")} {
			for _, exe := range []string{`Google\Chrome\Application\chrome.exe`, `Microsoft\Edge\Application\msedge.exe`, `BraveSoftware\Brave-Browser\Application\brave.exe`, `Chromium\Application\chrome.exe`} {
				if p := filepath.Join(dir, exe); dir != "" && isFile(p) {
					return p
				}
			}
		}
	case "darwin":
		home, _ := os.UserHomeDir()
		for _, dir := range []string{"/Applications", filepath.Join(home, "Applications")} {
			for _, app := range []string{"Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"} {
				if p := filepath.Join(dir, app+".app", "Contents", "MacOS", app); isFile(p) {
					return p
				}
			}
		}
	default:
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave", "brave-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	return ""
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// openApp opens u in a Chromium-family app window, or in the default browser
// when there is none. With redirect, the browser gets a file that redirects
// to u instead, so the token is not in its argv where other users can see it.
func openApp(u string, redirect bool, dir string) error {
	if redirect {
		var err error
		if u, err = writeRedirectFile(dir, u); err != nil {
			return err
		}
	}
	var cmd *exec.Cmd
	if b := findBrowser(); b != "" {
		cmd = exec.Command(b, "--app="+u)
	} else {
		switch runtime.GOOS {
		case "windows":
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
		case "darwin":
			cmd = exec.Command("open", u)
		default:
			cmd = exec.Command("xdg-open", u)
		}
	}
	// A browser started here may become the user's main browser process, so
	// it must not die with natter's terminal or Ctrl-C.
	detachProcess(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// writeRedirectFile writes dir/open.html, which sends the browser on to u,
// and returns its file:// URL.
func writeRedirectFile(dir, u string) (string, error) {
	p := filepath.Join(dir, "open.html")
	e := html.EscapeString(u)
	page := `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=` + e + `"><title>Natter</title><a href="` + e + `">Open Natter</a>` + "\n"
	if err := atomicfile.Write(p, []byte(page)); err != nil {
		return "", err
	}
	path := filepath.ToSlash(p)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path // C:/… on Windows
	}
	return (&url.URL{Scheme: "file", Path: path}).String(), nil
}
