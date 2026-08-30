//go:build linux

package bridge

import "syscall"

func restartCurrentProcess(path string, args, env []string) error {
	return syscall.Exec(path, args, env)
}
