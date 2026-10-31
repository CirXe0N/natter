// Package atomicfile writes Natter's own files so that a crash leaves the old
// file or the new one, and two natter processes sharing a directory take
// turns through a lock file.
package atomicfile

import (
	"fmt"
	"os"
	"path/filepath"
)

// Lock takes an exclusive lock on the file at path, creating it and its
// directory owner-only. The OS drops the lock if natter dies, so a crash
// never wedges it. Hold it across a read-modify-write.
func Lock(path string) (unlock func(), err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lock(f); err != nil {
		f.Close()
		return nil, fmt.Errorf("locking %s: %w", path, err)
	}
	return func() { f.Close() }, nil // closing releases the lock
}

// Write replaces path with data at mode 0600: temp file, fsync, rename, then
// a best-effort fsync of the directory (Windows cannot). Callers hold the
// Lock that guards path.
func Write(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*") // CreateTemp makes it 0600
	if err != nil {
		return err
	}
	defer os.Remove(f.Name()) // no-op after the rename
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		d.Sync()
		d.Close()
	}
	return nil
}
