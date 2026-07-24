#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_FILE="$ROOT_DIR/build/linux/gui.for.singbox-headless.service"

assert_contains() {
  local expected="$1"

  if ! grep -Fqx "$expected" "$SERVICE_FILE"; then
    printf 'missing systemd setting: %s\n' "$expected" >&2
    exit 1
  fi
}

assert_not_contains() {
  local unexpected="$1"

  if grep -Fq "$unexpected" "$SERVICE_FILE"; then
    printf 'unsupported systemd setting: %s\n' "$unexpected" >&2
    exit 1
  fi
}

assert_contains 'Environment="HOME=/opt/GUI.for.SingBox"'
assert_contains 'Environment="WEBUI_LISTEN=127.0.0.1:18080"'
assert_contains 'ExecStart=/opt/GUI.for.SingBox/GUI.for.SingBox --headless --webui-listen=${WEBUI_LISTEN} --webui-token=${WEBUI_TOKEN}'
assert_contains 'AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_DAC_OVERRIDE CAP_NET_RAW'
assert_contains 'CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE CAP_NET_DAC_OVERRIDE CAP_NET_RAW'
assert_not_contains 'WEBUI_TRUSTED_PROXY'
assert_not_contains 'WEBUI_EXTERNAL_HTTPS_ORIGIN'
assert_not_contains 'WEBUI_ORIGIN'

printf 'PASS: headless systemd service has the required runtime settings\n'
