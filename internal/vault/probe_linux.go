package vault

import (
	"context"
	"errors"
	"slices"

	"github.com/godbus/dbus/v5"
)

// probe checks for an owned or activatable org.freedesktop.secrets on a
// private bus connection with no autostart. go-keyring's dbus.SessionBus()
// runs dbus-launch when it finds no bus, and that must never happen.
func probe(ctx context.Context) error {
	conn, err := dbus.SessionBusPrivateNoAutoStartup()
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := conn.Auth(nil); err != nil {
		return err
	}
	if err := conn.Hello(); err != nil {
		return err
	}
	var owned bool
	if err := conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.NameHasOwner", 0, "org.freedesktop.secrets").Store(&owned); err != nil {
		return err
	}
	if owned {
		return nil
	}
	var names []string
	if err := conn.BusObject().CallWithContext(ctx, "org.freedesktop.DBus.ListActivatableNames", 0).Store(&names); err != nil {
		return err
	}
	if !slices.Contains(names, "org.freedesktop.secrets") {
		return errors.New("no Secret Service (org.freedesktop.secrets) on the session bus")
	}
	return nil
}
