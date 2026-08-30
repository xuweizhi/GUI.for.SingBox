# GUI.for.SingBox WebUI

GUI.for.SingBox 现在是一个仅面向服务端的 **headless + WebUI** sing-box 管理服务。项目不再包含桌面窗口、系统托盘、Wails WebView 或 Windows/macOS 桌面打包流程。

## 运行结构

- 单个 Go 服务进程托管 WebUI、RPC、事件流和 Clash API 反向代理。
- sing-box 核心作为服务的子进程运行。
- WebUI 编译产物嵌入 Go 二进制，生产环境不需要单独部署前端服务器。
- 运行数据默认位于二进制同级的 `data/` 目录。

默认监听地址为 `127.0.0.1:18080`。使用非回环地址时，如果未配置 Token，服务会自动生成 Token 并输出到日志。

## 环境要求

- Go：版本以 `go.mod` 为准
- Node.js
- pnpm
- Linux（生产部署目标）

不再需要 Wails CLI、GTK 或 WebKit 开发库。

## 构建

```bash
make install
make build
```

输出文件：`build/bin/GUI.for.SingBox`。

手动构建：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm build

cd ..
mkdir -p build/bin
go build -trimpath -ldflags="-s -w" -o build/bin/GUI.for.SingBox .
```

## 运行

```bash
./build/bin/GUI.for.SingBox
```

认证始终开启。未提供 `WEBUI_TOKEN` 时，服务会自动生成
`build/bin/data/webui-token`（权限 `0600`），登录时读取该文件即可。

可用参数：

```text
--webui-listen host:port
--webui-token token
```

也可以使用环境变量：

```bash
WEBUI_LISTEN=0.0.0.0:18080 \
WEBUI_TOKEN=replace-with-a-long-random-token \
./build/bin/GUI.for.SingBox
```

升级期间旧的 `--headless` 参数会被安全忽略，但它已不再出现在新部署配置中，因为 WebUI 服务是唯一运行模式。

## 与其他 sing-box 服务共存

本服务不再修改宿主机系统代理或系统 DNS，也不会创建托盘、窗口或桌面自启动项。HTTP 请求需要上游代理时，只读取进程环境中的 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` 和 `NO_PROXY`。

与其他 headless 服务共存时，只需确保以下资源不重复：

- `WEBUI_LISTEN` 监听端口；
- sing-box 配置中的入站端口和 Clash API 控制端口；
- 二进制所在目录及其同级 `data/` 数据目录。

因此，只要端口和数据目录独立，本项目不会主动修改或重启其他 sing-box 服务。

## systemd 部署

示例文件：

- `build/linux/gui.for.singbox-headless.service`
- `build/linux/gui.for.singbox-headless.env.example`

示例安装：

```bash
sudo install -d -o gui-for-singbox -g gui-for-singbox /opt/GUI.for.SingBox
sudo install -m 0755 build/bin/GUI.for.SingBox /opt/GUI.for.SingBox/GUI.for.SingBox
sudo install -d -o gui-for-singbox -g gui-for-singbox /opt/GUI.for.SingBox/data
sudo install -m 0644 build/linux/gui.for.singbox-headless.service \
  /etc/systemd/system/gui.for.singbox-headless.service
sudo install -m 0600 build/linux/gui.for.singbox-headless.env.example \
  /etc/default/gui.for.singbox-headless
sudo systemctl daemon-reload
sudo systemctl enable --now gui.for.singbox-headless
```

远程监听时务必设置强 Token，并通过防火墙、HTTPS 反向代理或可信内网限制访问。

## 原地重建并重启

```bash
./scripts/rebuild-restart-headless.sh
```

常用选项：

- `--no-install`：跳过 `pnpm install`
- `--service <name>`：指定 systemd unit
- `--status-only`：只查看服务状态
- `--restart-only`：仅重启服务

脚本只重启指定的 GUI.for.SingBox unit，不会操作其他 sing-box 管理服务。升级时请保留已有 `build/bin/data/`。

## 测试

```bash
make test
```

该命令包含 Go 单元测试、前端类型检查、前端单元测试和部署脚本检查。

## 主要目录

```text
bridge/                  WebUI RPC、事件、网络、核心进程与文件操作
frontend/                Vue WebUI
taskworker/              定时任务 worker
build/linux/             systemd 与环境变量示例
scripts/                 构建、重启和部署配置测试
```
