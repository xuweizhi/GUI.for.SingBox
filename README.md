## Preview

Take a look at the live version here: 👉 <a href="https://gui-for-cores.github.io/guide/gfs/" target="_blank">Live Demo</a>

<div align="center">
  <img src="docs/imgs/light.png">
</div>

## Document

[Community](https://gui-for-cores.github.io/guide/gfs/community)

## Build

1、Build Environment

- Node.js [link](https://nodejs.org/en)

- pnpm ：`npm i -g pnpm`

- Go [link](https://go.dev/)

- Wails [link](https://wails.io/) ：`go install github.com/wailsapp/wails/v2/cmd/wails@latest`

2、Pull and Build

```bash
git clone https://github.com/GUI-for-Cores/GUI.for.SingBox.git

cd GUI.for.SingBox/frontend

pnpm install --frozen-lockfile && pnpm build

cd ..

wails build
```

## Headless WebUI

Build artifacts now include a browser-targeted WebUI bundle, so the app can be started without opening the desktop window:

```bash
./GUI.for.SingBox --headless
```

Default listen address: `127.0.0.1:18080`

Optional flags:

- `--webui-listen 127.0.0.1:18080`
- `--webui-token your-token`

Examples:

```bash
# local only
./GUI.for.SingBox --headless --webui-listen 127.0.0.1:18080

# remote access
./GUI.for.SingBox --headless --webui-listen 0.0.0.0:18080 --webui-token change-me
```

When listening on a non-loopback address and no token is provided, the app will generate one automatically and print the access URL in stdout.

### Systemd service

A ready-to-edit systemd unit is included for Linux deployments:

- `build/linux/gui.for.singbox-headless.service`
- `build/linux/gui.for.singbox-headless.env.example`

The sample unit assumes the app is installed at `/opt/GUI.for.SingBox/GUI.for.SingBox` and will keep its `data/` directory under `/opt/GUI.for.SingBox`.

Example install:

```bash
sudo useradd --system --home /opt/GUI.for.SingBox --shell /usr/sbin/nologin gui-for-singbox

sudo mkdir -p /opt/GUI.for.SingBox
sudo cp GUI.for.SingBox /opt/GUI.for.SingBox/
sudo cp -r data /opt/GUI.for.SingBox/  # optional: only if you already have existing data
sudo chown -R gui-for-singbox:gui-for-singbox /opt/GUI.for.SingBox

sudo cp build/linux/gui.for.singbox-headless.service /etc/systemd/system/
sudo cp build/linux/gui.for.singbox-headless.env.example /etc/default/gui.for.singbox-headless

# edit listen/token or installation path if needed
sudo editor /etc/systemd/system/gui.for.singbox-headless.service
sudo editor /etc/default/gui.for.singbox-headless

sudo systemctl daemon-reload
sudo systemctl enable --now gui.for.singbox-headless
sudo systemctl status gui.for.singbox-headless
```

Common operations:

```bash
sudo systemctl restart gui.for.singbox-headless
sudo systemctl stop gui.for.singbox-headless
sudo journalctl -u gui.for.singbox-headless -f
```

## Stargazers over time

[![Stargazers over time](https://starchart.cc/GUI-for-Cores/GUI.for.SingBox.svg)](https://starchart.cc/GUI-for-Cores/GUI.for.SingBox)
