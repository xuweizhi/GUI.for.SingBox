//go:build !linux

package bridge

import "fmt"

func restartCurrentProcess(_ string, _, _ []string) error {
	return fmt.Errorf("in-process restart is only supported on Linux")
}
