package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

// A GUI browser is not attached to natter's console, so Ctrl-C there never reaches it.
func detachProcess(*exec.Cmd) {}

var kernel32 = syscall.NewLazyDLL("kernel32.dll")

// detachConsole closes the console window Windows opened for natter when it
// started from the Start Menu: then natter is the console's only process. Run
// from a terminal, the shell shares the console and natter keeps printing there.
func detachConsole() {
	var pids [2]uint32
	n, _, _ := kernel32.NewProc("GetConsoleProcessList").Call(uintptr(unsafe.Pointer(&pids[0])), uintptr(len(pids)))
	if n == 1 {
		kernel32.NewProc("FreeConsole").Call()
	}
}
