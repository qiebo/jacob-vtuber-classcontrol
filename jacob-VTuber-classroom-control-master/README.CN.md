# 远播翼生涯数字人桌面版（Open-LLM-VTuber 定制）

本仓库为教学场景和 kiosk 场景定制版，目标是：
- 双击桌面图标即可启动并自动全屏
- 支持角色、舞台、语音、交互的可视化配置
- 支持知识库实验能力
- 让人类运维者和代码智能体都能快速理解“仓库内容”和“机器本地状态”的边界

## 先说最重要的结论

从 Git 拉下来的仓库，只能保证“代码版本一致”，不能自动保证“设备状态一致”。

仓库里有：
- 后端代码
- 前端源码
- 角色 YAML 配置
- 部署脚本
- 文档

仓库里默认没有：
- `conf.yaml`
- API Key 和账号密码
- `.kiosk-profile/`
- 本地 ASR/TTS 模型文件
- 浏览器权限状态
- 音频输入源选择
- 屏幕旋转、触摸映射、桌面自启动等系统配置

所以新设备部署时，除了 `git clone`，还要补运行时配置。

## 新设备标准部署流程

### 1. 拉取仓库

```bash
git clone https://github.com/qiebo/jacob-VTuber.git ~/Open-LLM-VTuber
cd ~/Open-LLM-VTuber
```

### 2. 创建或复用虚拟环境

```bash
if [ -f venv/bin/activate ]; then
  source venv/bin/activate
elif [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
else
  python3 -m venv .venv
  source .venv/bin/activate
fi
```

### 3. 安装后端依赖

```bash
pip install -U pip
pip install -r requirements.txt
```

### 4. 重新构建前端

这一步在新设备上不要省略。

运行时优先读取 `frontend-source/dist/web`。如果这个目录不存在，程序可能回退到旧的静态前端目录，导致界面看起来像老版本。

```bash
cd frontend-source
npm install
npm run build
cd ..
```

### 5. 准备运行配置

首次可用前，至少确认：
- `conf.yaml` 已存在并符合当前设备需求
- LLM 提供方和 API Key 已配置
- ASR 方案已选定
- 如果使用本地 ASR，对应模型文件已经放到 `models/`
- 浏览器对麦克风权限已放行

### 6. 启动服务

```bash
python run_server.py
```

访问：`http://127.0.0.1:12393`

## 课堂教师端与 16 台设备管控

本仓库包含 `teacher-console/` 教师端，可在同一局域网管理至少 16 台学生设备，支持在线状态、缩略图、批量锁定、文件分发、作品收集和多学生档案恢复。

每台树莓派先执行：

```bash
cp .classroom.env.example .classroom.env
```

然后修改唯一设备编号、设备名称和全班共享令牌。`.classroom.env` 含敏感令牌，默认不会提交到 Git。

Windows 教师机运行构建后的：

```text
dist\JacobTeacherConsole.exe
```

详细部署、操作和验收步骤见 [`teacher-console/README.md`](teacher-console/README.md)。

## 桌面一键启动（推荐）

```bash
cd ~/Open-LLM-VTuber
bash scripts/raspberry_pi/install_desktop_shortcut.sh
```

安装后桌面图标名：`翼生涯桌面数智人`。  
双击可自动启动后端并进入 kiosk 全屏。

如需在树莓派桌面单独切换横屏/竖屏：

```bash
cd ~/Open-LLM-VTuber
bash scripts/raspberry_pi/install_orientation_shortcut.sh
```

安装后桌面会额外生成：`切换横竖屏.desktop`

## 人设说明

标准角色配置放在 `characters/` 下。

本仓库现在也会跟踪一部分“原本只存在浏览器本地存储中的自定义人设”，并把它们固化成 YAML 文件。这样以后新设备通过 Git 部署，也能直接拿到这些角色，而不再依赖 Chromium 的本地缓存。

如果你只是在前端页面里新建了人设，但没有把它整理进仓库，那么它仍然可能只存在于浏览器 `localStorage` 中。

## 部署注意事项（实战）

- **人设有两层来源**：`characters/*.yaml`（可版本化）和浏览器本地存储（`.kiosk-profile`，不可直接走 Git）。  
  如果“后端已有 YAML，但前端列表没显示”，优先检查/恢复 `.kiosk-profile`。
- **推荐把自定义人设固化进仓库**：新增人设后，确认 `characters/` 下有对应 `custom_browser_persona_*.yaml`，再提交到 Git，避免换机丢失。
- **前端更新后要重建**：`frontend-source` 有改动时，务必执行 `npm install && npm run build`，否则新设备可能仍显示旧界面。
- **USB 麦克风问题**：kiosk 启动脚本会优先选择 USB 输入源。若仍无声，先执行 `pactl list short sources` 确认设备名，再手动 `pactl set-default-source <source>`。
- **首次启动弹“keyring 密码”**：这是浏览器密码存储行为。当前启动脚本已添加 `--password-store=basic` 等参数用于抑制该弹窗。
- **云端同步前先检查仓库状态**：在提交前先跑 `git status -sb`，确保没有误删子模块（如 `frontend`）或临时文件混入。

## 云端一致性快速检查

```bash
git fetch origin
git status -sb
git rev-parse HEAD
git rev-parse origin/main
```

当 `HEAD` 与 `origin/main` 相同，且 `git status` 干净时，可认为本地与云端一致。

## 常用命令

启动：

```bash
python run_server.py
```

停止：

```bash
bash scripts/raspberry_pi/stop_vtuber.sh
```

全屏启动：

```bash
bash scripts/raspberry_pi/start_vtuber_fullscreen.sh
```

安装桌面快捷方式：

```bash
bash scripts/raspberry_pi/install_desktop_shortcut.sh
```

## 健康检查

```bash
curl -fsS http://127.0.0.1:12393/
curl -fsS http://127.0.0.1:12393/knowledge/files
```

## 给智能体的入口

如果你把仓库链接交给 Codex、Claude Code 或其他 coding agent，建议优先让它们读取：
- `AGENTS.md`
- `CLAUDE.md`
- `DEPLOYMENT.md`
- 本文件 `README.CN.md`
- `docs/项目开发记录.md`
- `docs/图片视频素材上传使用说明.md`

## 数据与配置目录

- 主配置：`conf.yaml`
- 角色配置：`characters/`
- 聊天记录：`chat_history/`
- 知识库：`knowledge_base/`
- Live2D 模型：`live2d-models/`
- 舞台背景：`backgrounds/`
- 本地运行浏览器状态：`.kiosk-profile/`
- 本地模型目录：`models/`

## 许可证

- 代码许可证：`LICENSE`
- Live2D 相关许可证：`LICENSE-Live2D.md`
