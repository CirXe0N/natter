package main

import (
	"encoding/binary"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/CirXe0N/natter/web"
)

// launcherPaths are what install-desktop writes, so uninstall removes the same.
// macOS gets one .app directory; the others get an entry and an icon in a
// folder of natter's own.
func launcherPaths() (entry, icon string, err error) {
	switch runtime.GOOS {
	case "windows":
		return filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs\Natter.lnk`),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Natter", "natter.ico"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		return filepath.Join(home, "Applications", "Natter.app"), "", err
	default:
		data := os.Getenv("XDG_DATA_HOME")
		if data == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", "", err
			}
			data = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(data, "applications", "natter.desktop"),
			filepath.Join(data, "natter", "natter.png"), nil
	}
}

// installDesktop adds a launcher entry that runs `exe open`.
func installDesktop(exe string) error {
	entry, icon, err := launcherPaths()
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "windows":
		if err := writeFile(icon, icoFile(web.Icon192, 192), 0o644); err != nil {
			return err
		}
		ps := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
			`$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:NATTER_LNK); $s.TargetPath = $env:NATTER_EXE; $s.Arguments = 'open'; $s.IconLocation = $env:NATTER_ICO; $s.WindowStyle = 7; $s.Description = 'A UI for NATS'; $s.Save()`)
		// Values go in the environment so no path needs PowerShell quoting.
		// WindowStyle 7 starts the console minimized until natter frees it.
		ps.Env = append(os.Environ(), "NATTER_LNK="+entry, "NATTER_EXE="+exe, "NATTER_ICO="+icon)
		if out, err := ps.CombinedOutput(); err != nil {
			return errors.New("creating the Start Menu shortcut: " + strings.TrimSpace(string(out)))
		}
		return nil
	case "darwin":
		c := filepath.Join(entry, "Contents")
		if err := writeFile(filepath.Join(c, "Info.plist"), []byte(infoPlist), 0o644); err != nil {
			return err
		}
		if err := writeFile(filepath.Join(c, "Resources", "natter.icns"), icnsFile(web.Icon512), 0o644); err != nil {
			return err
		}
		// Backgrounded so the app exits at once: a second click then runs
		// natter open again instead of activating an app with no window.
		script := "#!/bin/sh\n" + shellQuote(exe) + " open >/dev/null 2>&1 &\n"
		return writeFile(filepath.Join(c, "MacOS", "natter-open"), []byte(script), 0o755)
	default:
		if err := writeFile(icon, web.Icon512, 0o644); err != nil {
			return err
		}
		desktop := "[Desktop Entry]\nType=Application\nName=Natter\nComment=A UI for NATS™\n" +
			"Exec=" + desktopExecArg(exe) + " open\nIcon=" + icon + "\nTerminal=false\nCategories=Development;\n"
		return writeFile(entry, []byte(desktop), 0o644)
	}
}

// uninstallDesktop removes what installDesktop wrote. Nothing there is fine.
func uninstallDesktop() error {
	entry, icon, err := launcherPaths()
	if err != nil {
		return err
	}
	if err := os.RemoveAll(entry); err != nil {
		return err
	}
	if icon != "" {
		if err := os.Remove(icon); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		os.Remove(filepath.Dir(icon)) // natter's own folder, only if empty
	}
	return nil
}

func writeFile(p string, b []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, b, mode)
}

// desktopExecArg quotes s as one Exec argument (Desktop Entry spec, "The Exec
// key"), then escapes it as a string value.
func desktopExecArg(s string) string {
	q := `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "`", "\\`", `$`, `\$`).Replace(s) + `"`
	return strings.NewReplacer(`\`, `\\`, `%`, `%%`).Replace(q)
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Natter</string>
	<key>CFBundleIdentifier</key><string>io.github.cirxe0n.natter</string>
	<key>CFBundleExecutable</key><string>natter-open</string>
	<key>CFBundleIconFile</key><string>natter</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>LSUIElement</key><true/>
</dict>
</plist>
`

// icoFile wraps one size×size PNG in an ICO container (PNG entries need Vista or later).
func icoFile(png []byte, size byte) []byte {
	b := []byte{0, 0, 1, 0, 1, 0, size, size, 0, 0, 1, 0, 32, 0}
	b = binary.LittleEndian.AppendUint32(b, uint32(len(png)))
	b = binary.LittleEndian.AppendUint32(b, 22)
	return append(b, png...)
}

// icnsFile wraps a 512×512 PNG as the ic09 entry of an ICNS container.
func icnsFile(png []byte) []byte {
	b := binary.BigEndian.AppendUint32([]byte("icns"), uint32(16+len(png)))
	b = binary.BigEndian.AppendUint32(append(b, "ic09"...), uint32(8+len(png)))
	return append(b, png...)
}
