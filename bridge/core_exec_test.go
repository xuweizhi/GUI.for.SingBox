package bridge

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// Spawn a native executable with synthetic core arguments, without opening a
// controller or touching a real sing-box service.
func TestCoreOwnershipHelper(t *testing.T) {
	if os.Getenv("GUI_CORE_OWNERSHIP_HELPER") != "1" {
		return
	}
	if directory := os.Getenv("GUI_CORE_HELPER_DIRECTORY"); directory != "" {
		if err := os.Chdir(directory); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("ready", nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	time.Sleep(time.Hour)
}

func TestCoreProcessOwnershipReusesRelativeDirectoryAfterChdir(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("process cwd regression uses Linux /proc")
	}
	directory := t.TempDir()
	binary := filepath.Join(directory, "sing-box")
	writeNativeCoreHelper(t, binary)
	base, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(base, directory)
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"-test.run=^TestCoreOwnershipHelper$", "run", "-c", "config.json", "-D", relative}
	cmd := exec.Command(binary, args...)
	cmd.Env = append(os.Environ(), "GUI_CORE_OWNERSHIP_HELPER=1", "GUI_CORE_HELPER_DIRECTORY="+relative)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(directory, "ready")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("helper did not change directory")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !processMatchesCore(int32(cmd.Process.Pid), binary, args) {
		t.Fatal("relative -D must still identify our core after it changes working directory")
	}
}

func writeNativeCoreHelper(t *testing.T, path string) {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content, 0o755); err != nil {
		t.Fatal(err)
	}
}

func nativeCoreHelperArgs(directory string) []string {
	return []string{"-test.run=^TestCoreOwnershipHelper$", "run", "-c", filepath.Join(directory, "config.json"), "-D", directory}
}

func TestCoreProcessOwnershipRejectsForeignInstallAndConfiguration(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("native process introspection regression uses Linux /proc")
	}
	root := t.TempDir()
	owned := filepath.Join(root, "owned")
	foreign := filepath.Join(root, "foreign")
	for _, dir := range []string{owned, foreign} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeNativeCoreHelper(t, filepath.Join(dir, "sing-box"))
	}
	ownedPath := filepath.Join(owned, "sing-box")
	for _, test := range []struct {
		name, binary, config string
		matches              bool
	}{
		{"owned", ownedPath, owned, true},
		{"same basename other install", filepath.Join(foreign, "sing-box"), owned, false},
		{"same binary other config", ownedPath, foreign, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			cmd := exec.Command(test.binary, nativeCoreHelperArgs(test.config)...)
			cmd.Env = append(os.Environ(), "GUI_CORE_OWNERSHIP_HELPER=1")
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
			pid := int32(cmd.Process.Pid)
			if got := processMatchesCore(pid, ownedPath, nativeCoreHelperArgs(owned)); got != test.matches {
				t.Fatalf("process ownership = %v, want %v", got, test.matches)
			}
			pidPath := filepath.Join(root, "pid.txt")
			if err := os.WriteFile(pidPath, []byte(strconv.Itoa(int(pid))), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, got := existingCorePIDFromFile(ownedPath, pidPath, nativeCoreHelperArgs(owned)); got != test.matches {
				t.Fatalf("PID file reuse = %v, want %v", got, test.matches)
			}
			if processMatchesCore(pid, ownedPath, nil) {
				t.Fatal("must not claim a process without expected configuration evidence")
			}
		})
	}
}

func TestCoreProcessIdentityNormalizesPathsAndRejectsMissingValues(t *testing.T) {
	directory := t.TempDir()
	first, ok := coreProcessIdentity([]string{"-c", "config.json", "-D", directory}, directory)
	if !ok {
		t.Fatal("valid identity was rejected")
	}
	second, ok := coreProcessIdentity([]string{"--config=" + filepath.Join(directory, "config.json"), "--directory=" + directory}, directory)
	if !ok || len(first) != len(second) {
		t.Fatal("equivalent long options were rejected")
	}
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("equivalent identities differ: %v vs %v", first, second)
		}
	}
	attached, ok := coreProcessIdentity([]string{"-cconfig.json", "-D" + directory}, directory)
	if !ok || len(attached) != len(first) {
		t.Fatal("attached short options were rejected")
	}
	for i := range first {
		if attached[i] != first[i] {
			t.Fatalf("attached path differs: %v vs %v", attached, first)
		}
	}
	extra, ok := coreProcessIdentity([]string{"-cconfig.json", "-D" + directory, "-C/foreign"}, directory)
	if !ok || len(extra) != len(first)+1 || extra[len(extra)-1] != "config-directory=/foreign" {
		t.Fatalf("extra attached config directory must remain part of identity: %v", extra)
	}
	for _, args := range [][]string{nil, {"run"}, {"-c"}, {"--config="}, {"-c", "stdin"}, {"run", "--", "-c", "fake.json"}, {"-D", directory, "-D", directory}} {
		if _, ok := coreProcessIdentity(args, directory); ok {
			t.Fatalf("ambiguous identity accepted: %v", args)
		}
	}
}
