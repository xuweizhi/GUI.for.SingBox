# 重建并重启 Headless 服务 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 提供一条仓库内可复用命令，用于重建前端和 Wails 二进制，并重启 headless systemd 服务，同时支持跳过依赖安装、覆盖服务名、只查看状态和只重启。

**架构：** 新增一个仓库脚本封装现有手动运维步骤，在脚本内部顺序执行前端依赖校验、前端构建、Wails 构建和 `systemctl restart/status`。脚本通过简单参数解析支持 `--no-install`、`--service <name>`、`--status-only` 和 `--restart-only`，其中状态查询和仅重启都会提前退出，不触发构建。同时在 `README` 增加脚本入口和参数说明。

**技术栈：** Bash、pnpm、Wails CLI、systemd。

---

## 文件结构

- 创建：`scripts/rebuild-restart-headless.sh`，封装一条可复用的重建重启命令。
- 修改：`README.md`，记录脚本用途和调用方式。

### 任务 1：新增重建重启脚本

**文件：**
- 创建：`scripts/rebuild-restart-headless.sh`

- [ ] **步骤 1：编写脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="gui.for.singbox-headless"
SKIP_INSTALL=0
STATUS_ONLY=0
RESTART_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-install)
      SKIP_INSTALL=1
      shift
      ;;
    --service)
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
```

- [ ] **步骤 2：赋予执行权限**

运行：`chmod +x scripts/rebuild-restart-headless.sh`
预期：命令成功，无输出或仅权限变更。

### 任务 2：补充文档入口

**文件：**
- 修改：`README.md:107`

- [ ] **步骤 1：在升级章节补充脚本方式**

追加一段简短说明：

```md
Or use the repo helper script to rebuild and restart in one step:

```bash
./scripts/rebuild-restart-headless.sh
```

- `--no-install` skips `pnpm install --frozen-lockfile`
- `--service <name>` overrides the systemd service name
- `--status-only` shows service status without rebuilding
- `--restart-only` restarts the service without rebuilding
```

- [ ] **步骤 2：执行脚本验证通过**

运行：`./scripts/rebuild-restart-headless.sh --restart-only --service gui.for.singbox-headless`
预期：不触发前端构建或 `wails build`，直接执行 `systemctl restart gui.for.singbox-headless` 并输出当前服务状态。
