## Preview

Take a look at the live version here: 👉 <a href="https://gui-for-cores.github.io/guide/gfs/" target="_blank">Live Demo</a>

<div align="center">
  <img src="docs/imgs/light.png">
</div>

## Document

[Community](https://gui-for-cores.github.io/guide/gfs/community)

## Build and deployment guide

### Requirements

- Node.js
- pnpm: `npm i -g pnpm`
- Go
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

The frontend is configured around **pnpm** (`frontend/pnpm-lock.yaml`, `wails.json`), and the desktop/headless binary is built through **Wails**.

### Local build

```bash
git clone https://github.com/GUI-for-Cores/GUI.for.SingBox.git
cd GUI.for.SingBox

cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm build

cd ..
wails build
```

Build outputs:

- Desktop/headless binary: `build/bin/GUI.for.SingBox`
- Runtime data directory: `build/bin/data/`
- Browser-targeted WebUI bundle: `frontend/dist/webui/` (embedded into the binary during build)

### Run the headless WebUI locally

After building, the same binary can run without opening the desktop window:

```bash
./build/bin/GUI.for.SingBox --headless
```

Defaults:

- Listen address: `127.0.0.1:18080`
- CLI options:
  - `--webui-listen 127.0.0.1:18080`
  - `--webui-token your-token`

Examples:

```bash
# local only
./build/bin/GUI.for.SingBox --headless --webui-listen 127.0.0.1:18080

# remote access
./build/bin/GUI.for.SingBox --headless --webui-listen 0.0.0.0:18080 --webui-token change-me
```

When listening on a non-loopback address and no token is provided, the app will auto-generate one and print the access URL in stdout.

### Deploy with systemd (recommended for Linux)

Reusable deployment files are included:

- `build/linux/gui.for.singbox-headless.service`
- `build/linux/gui.for.singbox-headless.env.example`

The sample service expects:

- Binary path: `/opt/GUI.for.SingBox/GUI.for.SingBox`
- Working directory: `/opt/GUI.for.SingBox`
- Runtime data directory: `/opt/GUI.for.SingBox/data`

Example installation:

```bash
sudo useradd --system --home /opt/GUI.for.SingBox --shell /usr/sbin/nologin gui-for-singbox

sudo mkdir -p /opt/GUI.for.SingBox
sudo cp build/bin/GUI.for.SingBox /opt/GUI.for.SingBox/
sudo cp -r build/bin/data /opt/GUI.for.SingBox/
sudo chown -R gui-for-singbox:gui-for-singbox /opt/GUI.for.SingBox

sudo cp build/linux/gui.for.singbox-headless.service /etc/systemd/system/
sudo cp build/linux/gui.for.singbox-headless.env.example /etc/default/gui.for.singbox-headless

# adjust install path, listen address, and token if needed
sudo editor /etc/systemd/system/gui.for.singbox-headless.service
sudo editor /etc/default/gui.for.singbox-headless

sudo systemctl daemon-reload
sudo systemctl enable --now gui.for.singbox-headless
sudo systemctl status gui.for.singbox-headless
```

### Upgrade an existing deployment

If the service is already installed, a typical in-place upgrade flow is:

```bash
git pull

cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm build

cd ..
wails build

sudo install -m 755 build/bin/GUI.for.SingBox /opt/GUI.for.SingBox/GUI.for.SingBox
sudo systemctl restart gui.for.singbox-headless
sudo systemctl status gui.for.singbox-headless
```

Keep the existing `data/` directory unless you intentionally want to replace runtime data.

### Service configuration notes

- `WEBUI_LISTEN` defaults to `127.0.0.1:18080`
- `WEBUI_TOKEN` can be left empty only for loopback-only access
- For any remote bind (`0.0.0.0` / non-loopback), set an explicit token
- The sample service keeps `CAP_NET_ADMIN`, `CAP_NET_BIND_SERVICE`, `CAP_NET_DAC_OVERRIDE`, and `CAP_NET_RAW` so the app can still work with TUN, privileged ports, and raw-socket DNS/bootstrap when needed

### Common operations

```bash
sudo systemctl restart gui.for.singbox-headless
sudo systemctl stop gui.for.singbox-headless
sudo systemctl status gui.for.singbox-headless
sudo journalctl -u gui.for.singbox-headless -f
```

## Local adaptation log

This working tree is currently **6 commits ahead of `origin/main`**. The local adaptation history is:

| Date | Commit | Change |
| --- | --- | --- |
| 2026-06-11 | `b7eb9e8` | Added headless WebUI management mode for browser-based operation. |
| 2026-06-12 | `4987363` | Added the WebUI token-login design record. |
| 2026-06-12 | `3277bb4` | Added the WebUI token login flow. |
| 2026-06-12 | `18493bc` | Fixed missing assets on the headless login page. |
| 2026-06-12 | `7866833` | Changed WebUI token verification to use the RPC probe path. |
| 2026-06-12 | `4ae7a3d` | Fixed overview statistics streaming and added a memory fallback in the overview page. |

## Stargazers over time

[![Stargazers over time](https://starchart.cc/GUI-for-Cores/GUI.for.SingBox.svg)](https://starchart.cc/GUI-for-Cores/GUI.for.SingBox)
