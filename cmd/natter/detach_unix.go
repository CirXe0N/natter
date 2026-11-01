//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

func detachProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }

// detachConsole only matters on Windows.
func detachConsole() {}
