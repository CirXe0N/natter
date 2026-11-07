//go:build desktop

package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"

	"github.com/CirXe0N/natter/web"
)

// updateKey is the base64 of the raw Ed25519 key that signs updates, set
// with -ldflags "-X main.updateKey=…". Without it the build never updates
// itself, rather than accept unsigned updates.
var updateKey string

const updateManifest = "https://github.com/CirXe0N/natter/releases/latest/download/update-manifest.json"

// appID names Natter to the OS. On Wayland the window's app ID must match the
// installed io.github.cirxe0n.natter.desktop, or the launcher entry and icon
// stay unlinked from the running window.
const appID = "io.github.cirxe0n.natter"

func init() { windowApp = openWindow }

// openWindow serves Natter on a loopback port and shows it in a Wails window. The webview loads Natter's own server, so the Launch
// token, Host and Origin checks stay on, and Wails' asset server serves
// nothing.
func openWindow(vaultKey string) error {
	var win *application.WebviewWindow
	show := func() {
		if win != nil {
			win.Show()
			win.Focus()
		}
	}
	// New exits at once when another Natter window app is running, after
	// telling that one to show its window, so only one server ever starts.
	app := application.New(application.Options{
		Name:        "Natter",
		Description: "A UI for NATS™",
		Icon:        web.Icon512,
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               appID,
			OnSecondInstanceLaunch: func(application.SecondInstanceData) { show() },
		},
		Linux: application.LinuxOptions{ApplicationID: appID},
	})

	launchURL, errc, err := serveInBackground(func(open func(string) error) error {
		return run("127.0.0.1", 0, true, nil, false, vaultKey, open)
	})
	if err != nil {
		return err
	}
	go func() {
		if err := <-errc; err != nil {
			fmt.Fprintln(os.Stderr, "natter:", err)
		}
		app.Quit()
	}()

	win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Natter",
		URL:       launchURL,
		Width:     1280,
		Height:    800,
		MinWidth:  720,
		MinHeight: 480,
	})
	// Closing hides the window, so the server, its live updates and the
	// webview stay up until Quit. Natter comes back from the tray or the launcher.
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		win.Hide()
	})

	// macOS needs an application menu for Cmd+C, Cmd+V and Cmd+Q to reach
	// the webview. None of these roles binds Cmd+K: the page's command
	// palette owns it. Elsewhere the window has no menu bar.
	if runtime.GOOS == "darwin" {
		menu := app.NewMenu()
		menu.AddRole(application.AppMenu)
		menu.AddRole(application.EditMenu)
		menu.AddRole(application.ViewMenu)
		menu.AddRole(application.WindowMenu)
		app.Menu.Set(menu)
	}

	tray := app.SystemTray.New()
	tray.SetIcon(web.Icon192)
	tray.SetTooltip("Natter")
	if runtime.GOOS == "linux" {
		// The tray item's title, which Wails would call "Wails". On macOS a
		// label is text beside the icon, so it stays unset there.
		tray.SetLabel("Natter")
	}
	tray.OnClick(show)
	trayMenu := app.NewMenu()
	trayMenu.Add("Open Natter").OnClick(func(*application.Context) { show() })
	if canUpdate() {
		if err := initUpdater(app); err != nil {
			fmt.Fprintln(os.Stderr, "natter: updates are off:", err)
		} else {
			trayMenu.Add("Check for Updates…").OnClick(func(*application.Context) {
				go app.Updater.CheckAndInstall(context.Background())
			})
		}
	}
	trayMenu.AddSeparator()
	trayMenu.Add("Quit Natter").OnClick(func(*application.Context) { app.Quit() })
	tray.SetMenu(trayMenu)

	return app.Run()
}

// canUpdate reports whether this copy can replace itself. A Linux package
// manager owns its copy, so there only the AppImage updates.
func canUpdate() bool {
	if updateKey == "" || version == "" {
		return false
	}
	return runtime.GOOS != "linux" || os.Getenv("APPIMAGE") != ""
}

func initUpdater(app *application.App) error {
	key, err := base64.StdEncoding.DecodeString(updateKey)
	if err != nil {
		return err
	}
	p, err := endpoint.New(endpoint.Config{URL: updateManifest})
	if err != nil {
		return err
	}
	return app.Updater.Init(updater.Config{
		CurrentVersion: version,
		Providers:      []updater.Provider{p},
		PublicKey:      key,
		CheckInterval:  24 * time.Hour,
	})
}
