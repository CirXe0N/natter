package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestInstallDesktopWritesAnXDGEntryThatUninstallRemoves(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the XDG entry is the Linux launcher")
	}
	data := t.TempDir()
	t.Setenv("XDG_DATA_HOME", data)
	exe := `/opt/my apps/$HOME/"natter"`

	if err := installDesktop(exe); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(data, "applications", "natter.desktop")
	b, err := os.ReadFile(entry)
	if err != nil {
		t.Fatal(err)
	}
	if want := `Exec="/opt/my apps/\\$HOME/\\"natter\\"" open` + "\n"; !strings.Contains(string(b), want) {
		t.Errorf("entry lacks %q:\n%s", want, b)
	}
	icon := filepath.Join(data, "natter", "natter.png")
	if !strings.Contains(string(b), "Icon="+icon+"\n") {
		t.Errorf("entry does not point at %s:\n%s", icon, b)
	}
	if png, _ := os.ReadFile(icon); !bytes.HasPrefix(png, []byte("\x89PNG")) {
		t.Error("icon is not a PNG")
	}
	if v, err := exec.LookPath("desktop-file-validate"); err == nil {
		if out, err := exec.Command(v, entry).CombinedOutput(); err != nil || len(out) > 0 {
			t.Errorf("desktop-file-validate: %v\n%s", err, out)
		}
	}

	if err := uninstallDesktop(); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{entry, filepath.Dir(icon)} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s still exists after uninstall", p)
		}
	}
	if err := uninstallDesktop(); err != nil {
		t.Errorf("second uninstall: %v, want nothing to do", err)
	}
}

func TestIconContainersWrapThePNG(t *testing.T) {
	png := []byte("\x89PNG fake")

	ico := icoFile(png, 192)
	if !bytes.Equal(ico[:6], []byte{0, 0, 1, 0, 1, 0}) || ico[6] != 192 || ico[7] != 192 {
		t.Errorf("ICO header = % x", ico[:8])
	}
	if size, off := binary.LittleEndian.Uint32(ico[14:]), binary.LittleEndian.Uint32(ico[18:]); int(size) != len(png) || !bytes.Equal(ico[off:], png) {
		t.Errorf("ICO entry size %d offset %d does not frame the PNG", size, off)
	}

	icns := icnsFile(png)
	if string(icns[:4]) != "icns" || int(binary.BigEndian.Uint32(icns[4:])) != len(icns) || string(icns[8:12]) != "ic09" || !bytes.Equal(icns[16:], png) {
		t.Errorf("ICNS = % x", icns[:16])
	}
}
