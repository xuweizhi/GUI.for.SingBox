#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/rebuild-restart-headless.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
FAKE_GOPATH="$TMP_DIR/gopath"
mkdir -p "$FAKE_BIN" "$FAKE_GOPATH/bin"

cat >"$FAKE_BIN/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

cat >"$FAKE_BIN/go" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -eq 2 && "${1:-}" == "env" && "${2:-}" == "GOPATH" ]]; then
  printf '%s\n' "$FAKE_GOPATH"
  exit 0
fi
printf 'unexpected go invocation: %s\n' "$*" >&2
exit 1
EOF

cat >"$FAKE_GOPATH/bin/wails" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'wails fallback ok\n'
EOF

cat >"$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec "$@"
EOF

cat >"$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

chmod +x "$FAKE_BIN/pnpm" "$FAKE_BIN/go" "$FAKE_GOPATH/bin/wails" "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl"

OUTPUT=$(PATH="$FAKE_BIN" "$SCRIPT_PATH" --no-install 2>&1)

if [[ "$OUTPUT" != *"wails fallback ok"* ]]; then
  printf 'expected fallback wails execution, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

printf 'PASS: rebuild-restart-headless resolves wails via GOPATH fallback\n'
