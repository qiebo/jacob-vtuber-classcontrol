# AGENTS.md

本文件是给 Codex、Claude Code 等智能体的部署与维护入口。
目标：拿到仓库后，能在树莓派上稳定部署、启动并交付可用系统。

## 1. 目标环境
- OS: Raspberry Pi OS / Debian Linux
- 项目目录: `~/Open-LLM-VTuber`
- 默认服务地址: `http://127.0.0.1:12393`

## 2. 必做约束
- 优先复用现有虚拟环境：`venv` 或 `.venv`。
- 不要删除用户数据目录：`chat_history/`、`knowledge_base/`、`live2d-models/`、`backgrounds/`。
- 涉及配置变更时，优先保留 `conf.yaml` 中已有 API 密钥与个性化配置。

## 3. 标准部署流程（给智能体直接执行）
1. 进入目录：`cd ~/Open-LLM-VTuber`
2. 同步代码：`git pull --ff-only`
3. 激活虚拟环境：
   - 若存在 `venv/bin/activate`：`source venv/bin/activate`
   - 否则若存在 `.venv/bin/activate`：`source .venv/bin/activate`
   - 都不存在才新建：`python3 -m venv .venv && source .venv/bin/activate`
4. 安装依赖：`pip install -U pip && pip install -r requirements.txt`
5. 启动服务：`python run_server.py`

## 4. 快速验收
新开终端执行：
- `curl -fsS http://127.0.0.1:12393/`
- `curl -fsS http://127.0.0.1:12393/knowledge/files`

通过标准：两个接口都返回 200。

## 5. 桌面一键启动（课堂模式）
执行：
`bash scripts/raspberry_pi/install_desktop_shortcut.sh`

安装后桌面应出现：`翼生涯桌面数智人.desktop`。
双击后应自动：
- 启动后端
- 打开浏览器
- 进入 kiosk 全屏模式

## 6. 关停
- 网页内点击“退出项目”按钮（推荐）
- 或终端执行：`bash scripts/raspberry_pi/stop_vtuber.sh`

## 7. 文档入口
- 部署总说明：`DEPLOYMENT.md`
- 项目说明（中文）：`README.CN.md`
- Claude 专用提示：`CLAUDE.md`
