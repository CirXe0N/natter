package vault

import (
	"bufio"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

// privateBus starts a dbus-daemon whose only activatable services are those
// in services, and points DBUS_SESSION_BUS_ADDRESS at it.
func privateBus(t *testing.T, services map[string]string) string {
	t.Helper()
	if _, err := exec.LookPath("dbus-daemon"); err != nil {
		t.Skip("dbus-daemon is not installed")
	}
	dir := t.TempDir()
	for name, body := range services {
		if err := os.WriteFile(filepath.Join(dir, name+".service"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	conf := filepath.Join(t.TempDir(), "bus.conf")
	if err := os.WriteFile(conf, []byte(`<busconfig><type>session</type><listen>unix:dir=`+dir+`</listen><servicedir>`+dir+`</servicedir><auth>EXTERNAL</auth><policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/><allow user="*"/></policy></busconfig>`), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("dbus-daemon", "--config-file="+conf, "--nofork", "--print-address")
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cmd.Process.Kill(); cmd.Wait() })
	addr, err := bufio.NewReader(out).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	addr = strings.TrimSpace(addr)
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", addr)
	return addr
}

func TestTheProbeFindsAnOwnedOrActivatableSecretService(t *testing.T) {
	t.Run("absent", func(t *testing.T) {
		privateBus(t, nil)
		if err := probe(t.Context()); err == nil || !strings.Contains(err.Error(), "no Secret Service") {
			t.Fatalf("probe on a bus without org.freedesktop.secrets: %v", err)
		}
	})
	t.Run("owned", func(t *testing.T) {
		addr := privateBus(t, nil)
		conn, err := dbus.Connect(addr)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		if reply, err := conn.RequestName("org.freedesktop.secrets", 0); err != nil || reply != dbus.RequestNameReplyPrimaryOwner {
			t.Fatal(reply, err)
		}
		if err := probe(t.Context()); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("activatable", func(t *testing.T) {
		marker := filepath.Join(t.TempDir(), "started")
		privateBus(t, map[string]string{"org.freedesktop.secrets": "[D-BUS Service]\nName=org.freedesktop.secrets\nExec=/usr/bin/touch " + marker + "\n"})
		if err := probe(t.Context()); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(marker); err == nil {
			t.Fatal("the probe activated the service; it must only list it")
		}
	})
}

func TestOSKeyringGivesUpOnABusThatNeverAnswers(t *testing.T) {
	old := keyringTimeout
	keyringTimeout = 300 * time.Millisecond
	t.Cleanup(func() { keyringTimeout = old })
	sock := filepath.Join(t.TempDir(), "bus")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			t.Cleanup(func() { c.Close() })
		}
	}()
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path="+sock)
	start := time.Now()
	if _, err := OSKeyring(t.Context()); err == nil || time.Since(start) > keyringTimeout+200*time.Millisecond {
		t.Fatalf("OSKeyring returned %v after %v", err, time.Since(start))
	}
}
