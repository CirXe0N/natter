// Package natstest runs an embedded nats-server for Go tests and the e2e
// harness, and writes natscli Context files that point at it.
//
// Users, each with password equal to its name:
//
//	sys  in SYS, the system account
//	app  in APP, with JetStream
//	nojs in NOJS, without JetStream
package natstest

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/nats-io/nats-server/v2/server"
)

const config = `
host: 127.0.0.1
port: -1
http: 127.0.0.1:-1
system_account: SYS
jetstream { store_dir: %q }
accounts {
  SYS  { users [{user: sys,  password: sys}] }
  APP  { jetstream: enabled, users [{user: app, password: app}] }
  NOJS { users [{user: nojs, password: nojs}] }
}
`

// Start runs a server with JetStream storage and its config file under dir.
// The Monitoring URL is "http://" + s.MonitorAddr().String().
func Start(dir string) (*server.Server, error) {
	conf := filepath.Join(dir, "nats-server.conf")
	if err := os.WriteFile(conf, fmt.Appendf(nil, config, filepath.Join(dir, "jetstream")), 0o600); err != nil {
		return nil, err
	}
	opts, err := server.ProcessConfigFile(conf)
	if err != nil {
		return nil, err
	}
	opts.NoSigs, opts.NoLog = true, true
	s, err := server.NewServer(opts)
	if err != nil {
		return nil, err
	}
	go s.Start()
	if !s.ReadyForConnections(10 * time.Second) {
		s.Shutdown()
		return nil, errors.New("embedded NATS server did not start")
	}
	return s, nil
}

// WriteContext writes a natscli Context file, root/nats/context/<name>.json,
// with the given natscontext JSON fields ("url", "user", "password", ...).
func WriteContext(root, name string, fields map[string]string) error {
	dir := filepath.Join(root, "nats", "context")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	b, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, name+".json"), b, 0o600)
}
