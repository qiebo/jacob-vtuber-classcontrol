# Jacob VTuber 课堂管控系统

> 基于 [Open-LLM-VTuber](https://github.com/qiebo/jacob-VTuber-classroom-control) 改造的课堂多设备管控系统：树莓派学生机 + Windows 教师管控台 + 学生身份识别 + 作品收集 + 远程管控。
>
> **当前进度**：M1-M6 全部完成（86 项本地测试 + 树莓派端到端实测全过）；联调期已修 5 个现场问题。

## 项目目标

让单机数智人（数字人）VTuber 部署到一间教室的 16 台树莓派学生机上，由教师机统一登录、归班、管控、收取作品、监控课堂。

- **学生机（树莓派5）**：kiosk 模式跑数智人，每个学生用唯一 username 登录，工作区按 username 隔离
- **教师机（Windows 笔记本）**：pywebview 桌面应用，登录后管理设备/班级/用户，监控缩略图，远程锁屏/收取作品
- **离线优先**：学生机离线也能创建用户名（pending_sync），上线后自动同步教师机；冲突自动改名

## 仓库结构

```
vtuber-classcontrol/                        # 工作区根（本仓库）
├── README.md                               # 本文件
├── HANDOFF.md                              # 详细的开发交接文档（含每一阶段的根因分析与修复）
├── .gitignore
├── docs/
│   ├── PRD.md                              # 产品需求文档
│   ├── 开发文档.md                          # 架构与接口设计
│   └── M1启动指南.md                        # 起步工作模式
├── jacob-VTuber-classroom-control-master/  # 主项目源码（学生端 + 教师端 + 前端）
│   ├── src/open_llm_vtuber/                # 学生端（FastAPI 后端）
│   │   ├── classroom/
│   │   │   ├── models.py                   # M1：username 主键模型
│   │   │   ├── storage.py                  # M1：UserRegistry/SavePointStore/rename_user
│   │   │   ├── routes.py                   # /classroom/* 路由
│   │   │   ├── auth.py                     # M2：登录/创建/退出/会话
│   │   │   ├── workspace.py                # M2：打包/恢复/存档点 CRUD
│   │   │   └── sync_manager.py             # M2：离线创建后台同步
│   │   ├── service_context.py              # M1：classroom_username 等镜像字段
│   │   ├── websocket_handler.py            # M1：与上下文同步
│   │   └── server.py                       # 路由装配 + 后台任务启动
│   ├── teacher-console/teacher_console/    # 教师端
│   │   ├── auth.py                         # M3：bcrypt 鉴权 + 会话 token
│   │   ├── user_store.py                   # M4：全局用户名注册表
│   │   ├── class_store.py                  # M4：班级 CRUD
│   │   ├── scan_service.py                 # M4：60s 后台扫描
│   │   ├── student_client.py               # M5：collect_profile/get_thumbnail/force_save
│   │   ├── app.py                          # /api/* 路由（auth/devices/users/classes/scan/thumbnail/lock/save/submit/batch/collect-stream）
│   │   ├── __main__.py                     # M3：pywebview 窗口启动
│   │   └── static/                         # 教师端前端（vanilla JS + HTML）
│   ├── frontend-source/                    # 学生端前端（Electron + React + Chakra）
│   │   └── src/renderer/src/
│   │       ├── components/classroom/
│   │       │   ├── login.tsx               # M2：登录页
│   │       │   ├── classroom-gate.tsx      # M2：路由守卫
│   │       │   └── classroom-snapshot-uploader.tsx  # M5：30s/320x180 缩略图
│   │       └── context/classroom-context.tsx        # auth/profile/workspace 全局状态
│   ├── tests/                              # 学生端测试（49 项 passed）
│   ├── teacher-console/tests/              # 教师端测试（37 项 passed）
│   ├── config_templates/
│   │   ├── conf.default.yaml               # 原始完整模板
│   │   └── conf.classroom.yaml             # 课堂精简模板（M6 部署固化）
│   └── deploy/
│       └── setup_pi.sh                     # 树莓派一键环境配置脚本（屏幕+音频+VNC）
└── pi_*.py / smoke_*.py                    # 本地辅助脚本（SSH 部署、冒烟）
```

## 已完成的里程碑

| 里程碑 | 内容 | 测试 |
|---|---|---|
| **M1** | 数据模型 `profile_id (class_slug__student_slug)` → `username` 主键重构 | 36 (storage+api+files) |
| **M2** | 学生端 `auth.py`/`workspace.py`/`sync_manager.py` + 前端登录页 + 路由守卫 | 13 (M2) + 27 项端到端 |
| **M3** | 教师端 bcrypt 鉴权 + pywebview 桌面窗口 + 前端登录遮罩 | 5 (auth) |
| **M4** | 教师端 `user_store`/`class_store`/`scan_service` + `/api/users/*`、`/api/classes/*`、`/api/scan/*` | 16 (M4) |
| **M5** | 低频缩略图（30s/320x180）+ 管控增强（解锁/强制保存提交）+ SSE 进度化批量收集 | 8 (M5) |
| **M6** | logout 恢复默认配置 + 设置面板收起 + 部署固化（`conf.classroom.yaml` + `setup_pi.sh`） | 全量 86 项回归 |
| **联调修复** | 档案显示/缩略图路径/班级移除/顶栏丢失/麦克风/启动清登录态/登录加载形象/VNC 横屏 | 树莓派实测 |

详细每阶段的根因与改动记录见 [HANDOFF.md](HANDOFF.md) 第 12.8-12.13 节。

## 部署架构

```
┌─────────────────────────────┐         ┌───────────────────────────────────┐
│  教师机 (Windows)           │         │  树莓派 5 学生机 (×16)             │
│                             │         │                                   │
│  pywebview 窗口             │  HTTPS  │  chromium kiosk                  │
│  http://127.0.0.1:8765      │ ──────▶ │  http://localhost:12393          │
│  (FastAPI + bcrypt 鉴权)    │   API   │  (FastAPI + classroom_token)     │
│                             │         │                                   │
│  • 设备管理/扫描            │         │  • 学生登录/创建/退出             │
│  • 用户管理（users.json）   │ ◀────── │  • 工作区打包/存档点              │
│  • 班级管理（classes.json） │  POST   │  • 离线 pending_sync              │
│  • 缩略图墙 / SSE 收集流    │ /sync   │  • 30s 缩略图上报                 │
│  • 锁屏/解锁/强制保存       │         │  • wm8960 麦克风 + sherpa-onnx ASR│
│                             │         │  • 通义千问 LLM (云)              │
│                             │         │  • 火山引擎 TTS (云)              │
│  默认账号: ybszr / 123456   │         │  Token: classroom-test-2026       │
└─────────────────────────────┘         └───────────────────────────────────┘
                                                  │
                                                  │ SSH/SFTP/wayvnc
                                                  ▼
                                         开发机用 paramiko 连
                                         192.168.100.133:22 (SSH)
                                         192.168.100.133:5900 (VNC)
```

## 快速上手

### 1. 启动教师端（Windows，本机）

```cmd
:: 进入工作区
cd /d E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\teacher-console

:: 启动（pywebview 窗口模式）
set PYTHONPATH=%CD%
..\..\teacher-venv\Scripts\python.exe -m teacher_console

:: 或无窗口模式（用浏览器访问）
..\..\teacher-venv\Scripts\python.exe -m teacher_console --no-window --port 8765
:: 浏览器开 http://127.0.0.1:8765/
```

默认账号：**ybszr / 123456**（首次登录后建议改密 `/api/auth/password`）。

### 2. 启动学生端（树莓派）

桌面双击「翼生涯桌面数智人」快捷方式，或：
```bash
cd ~/Open-LLM-VTuber
./.venv/bin/python run_server.py
```

学生在 kiosk 登录页输入用户名 → 创建（首次）/登录 → 进入工作区。

### 3. 远程访问树莓派（VNC）

```
地址：192.168.100.133
端口：5900
密码：（无）
```

### 4. 在教师端添加学生设备

教师端登录后，左侧"添加设备"：
- ID：`pi-01`
- 名称：`树莓派5-1`
- 地址：`http://192.168.100.133:12393`
- Token：`classroom-test-2026`

## 跑测试

```cmd
cd /d E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master

:: 学生端（49 项）
set PYTHONPATH=src
..\teacher-venv\Scripts\python.exe -m pytest tests/ -q

:: 教师端（37 项）
set PYTHONPATH=teacher-console
..\teacher-venv\Scripts\python.exe -m pytest teacher-console/tests/ -q
```

## 部署到新树莓派

1. 烧录 Raspberry Pi OS（带桌面，labwc/Wayland）+ 安装项目依赖（参考原项目 README）
2. 把 `jacob-VTuber-classroom-control-master/` 同步到树莓派 `~/Open-LLM-VTuber/`
3. 一键配置环境：
   ```bash
   cd ~/Open-LLM-VTuber
   bash deploy/setup_pi.sh
   ```
   脚本会：
   - 部署精简版 `conf.yaml`（自动从旧配置继承密钥）
   - 配置 labwc autostart（HDMI/DSI 智能切换 + wm8960 麦克风 + wayvnc 自启）
   - 禁用与 autostart 冲突的旧配置

详见 [`deploy/setup_pi.sh`](jacob-VTuber-classroom-control-master/deploy/setup_pi.sh) 和 [`config_templates/conf.classroom.yaml`](jacob-VTuber-classroom-control-master/config_templates/conf.classroom.yaml)。

## 目前已知遗留 / 待办

- **班级管理 UI**：用户要求"先撤掉，待详细设计"，后端 `/api/classes/*`、`/api/users/*` 路由保留可用，前端 UI 已移除
- **教师端前端**：班级/用户列表、缩略图墙、SSE 进度条等高级 UI 待补（后端 API 已就绪）
- **离线创建提示条 / 冲突改名 UI**：state 已暴露，UI 待打磨
- **树莓派 5 GPU 不支持 GPGPU**：ASR 只能 CPU，已是合理配置（sherpa-onnx int8 + 4 线程）
- **silero VAD 因 torch 依赖被禁用**：靠前端浏览器侧处理 VAD，与原版行为一致

## 开发约定

- **方法论**：见 `docs/M1启动指南.md`，串行执行 + 并行子 agent 调研
- **改动追踪**：每个里程碑/修复都在 [HANDOFF.md](HANDOFF.md) 第 12 节增补一节，记录根因/改动文件/测试结果
- **测试基线**：每次改动后必须 86 项全绿（49 学生端 + 37 教师端）
- **真机验证**：核心改动必须在树莓派 192.168.100.133 上跑端到端冒烟，不仅靠单元测试

## 联系/凭据

- 树莓派：`yb@192.168.100.133`，密码 `1`
- 学生端 token：`classroom-test-2026`（写在 `~/Open-LLM-VTuber/.classroom.env`）
- 教师端默认账号：`ybszr / 123456`
- 通义千问 / 火山引擎 API key：在树莓派 `~/Open-LLM-VTuber/conf.yaml`（**不入库**）
