#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/rebuild-restart-headless.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/pnpm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

cat >"$FAKE_BIN/go" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "build" ]]; then
  printf 'go build ok: %s\n' "$*"
  exit 0
fi
printf 'unexpected go invocation: %s\n' "$*" >&2
exit 1
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

chmod +x "$FAKE_BIN/pnpm" "$FAKE_BIN/go" "$FAKE_BIN/sudo" "$FAKE_BIN/systemctl"

OUTPUT=$(PATH="$FAKE_BIN:$PATH" "$SCRIPT_PATH" --no-install 2>&1)

if [[ "$OUTPUT" != *"go build ok: build -trimpath -ldflags=-s -w -X guiforcores/bridge.AppVersion="* ]]; then
  printf 'expected a plain Go headless build, got:\n%s\n' "$OUTPUT" >&2
  exit 1
fi

printf 'PASS: rebuild-restart-headless uses the plain Go build\n'
