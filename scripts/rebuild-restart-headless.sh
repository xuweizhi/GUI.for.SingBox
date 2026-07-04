#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="gui.for.singbox-headless"
SKIP_INSTALL=0
STATUS_ONLY=0
RESTART_ONLY=0

usage() {
  cat <<'EOF'
Usage: ./scripts/rebuild-restart-headless.sh [--no-install] [--service <name>] [--status-only] [--restart-only]

Options:
  --no-install       Skip pnpm install --frozen-lockfile
  --service <name>   Override the systemd service name
  --status-only      Show systemd status only
  --restart-only     Restart and show status without rebuilding
  -h, --help         Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install)
      SKIP_INSTALL=1
      shift
      ;;
    --service)
      if [[ $# -lt 2 ]]; then
        printf 'Missing value for --service\n' >&2
        usage >&2
        exit 1
      fi
      SERVICE_NAME="$2"
      shift 2
      ;;
    --status-only)
      STATUS_ONLY=1
      shift
      ;;
    --restart-only)
      RESTART_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  systemctl status "$SERVICE_NAME" --no-pager
  exit 0
fi

if [[ "$RESTART_ONLY" -eq 1 ]]; then
  sudo systemctl restart "$SERVICE_NAME"
  systemctl status "$SERVICE_NAME" --no-pager
  exit 0
fi

cd "$ROOT_DIR/frontend"
if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  pnpm install --frozen-lockfile
fi
pnpm build

cd "$ROOT_DIR"
wails build

sudo systemctl restart "$SERVICE_NAME"
systemctl status "$SERVICE_NAME" --no-pager
