# Jacob VTuber 课堂管控系统 — 最小可交付版开发文档（MVP）

| 项目 | 内容 |
|------|------|
| 文档版本 | MVP v1.0 |
| 编写日期 | 2026-06-18 |
| 状态 | 与 `PRD_MVP.md` 对齐 |
| 原则 | 稳定优先，保留课堂闭环必需功能，暂缓班级复杂设计 |

---

## 1. MVP 总体架构

```
教师端 Windows
  teacher_console FastAPI + pywebview/浏览器
  http://127.0.0.1:8765
    ├─ /api/auth/*              教师登录
    ├─ /api/devices/*           设备管理/锁定/收取/分发
    ├─ /api/batch/*             批量操作
    ├─ /api/discover            局域网发现
    └─ /api/collections         收取结果

局域网 HTTP
  X-Classroom-Token

学生端树莓派
  Open-LLM-VTuber FastAPI + Chromium kiosk
  http://0.0.0.0:12393
    ├─ /auth/*                  学生用户名创建/登录/退出
    ├─ /classroom/*             状态/锁屏/文件/导出
    └─ /workspace/*             打包/恢复/存档点
```

---

## 2. 数据模型

### 2.1 学生端 Profile

路径：`classroom_data/profiles/{username}/profile.yaml`

```yaml
schema_version: 2
username: Student01
class_name: null          # MVP 暂不使用，可保留字段但不展示
character_config: {}
workspace_state: {}
created_at: ...
updated_at: ...
last_saved_at: ...
dirty: false
submitted: false
pending_sync: false
```

### 2.2 runtime_state

路径：`classroom_data/runtime_state.json`

```json
{
  "current_username": null,
  "locked": false,
  "session_token": null
}
```

MVP 要求：

- 后端启动时清空 `current_username` 和 `session_token`。
- 重启后必须显示登录页，不能自动登录。

### 2.3 本地用户注册表

路径：`classroom_data/registry/local_users.json`

```json
{
  "version": 1,
  "users": [
    {
      "username": "Student01",
      "created_at": "...",
      "pending_sync": false,
      "last_login_at": "..."
    }
  ]
}
```

MVP 阶段：

- 本地去重必须可用。
- 教师端全局同步可保留后端能力，但 UI 暂缓。

---

## 3. 学生端后端模块

### 3.1 `classroom/models.py`

保留：

- `ClassroomProfile.username`
- `pending_sync`
- `ClassroomStatus.current_username`

不再使用：

- `profile_id`
- `class_slug`
- `student_slug`
- `student_name`

---

### 3.2 `classroom/storage.py`

核心函数：

| 函数/类 | 用途 |
|--------|------|
| `ensure_safe_username` | 校验 username，仅字母数字 1–32 |
| `profile_dir_for_username` | 返回 `profiles/{username}` |
| `create_profile` | 创建/更新 profile |
| `get_profile` | 按 username 读 profile |
| `write_profile` | 写 profile.yaml + manifest.json |
| `build_export_zip` | 打包当前工作区 |
| `UserRegistry` | 本地用户名注册表 |
| `SavePointStore` | 存档点 CRUD |
| `rename_user` | 离线冲突改名（后续可用） |

MVP 注意：

- `build_export_zip(username)` 是教师端收取作品的核心。
- 收取前应先保存当前状态。

---

### 3.3 `classroom/auth.py`

MVP 使用接口：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/auth/check-username` | 创建前本地去重/离线检查 |
| POST | `/auth/create` | 创建用户名并登录 |
| POST | `/auth/login` | 登录已有用户名 |
| POST | `/auth/logout` | 退出，清 runtime_state |
| GET | `/auth/me` | 当前登录状态 |

关键逻辑：

- 后端启动注册路由时清空登录态。
- `/auth/create` 和 `/auth/login` 返回 profile。
- 前端必须把返回的 `profile.character_config` 应用到 Live2D，否则人物形象不会加载。

---

### 3.4 `classroom/workspace.py`

MVP 使用接口：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/workspace/pack` | 打包当前 username 工作区 |
| POST | `/workspace/restore` | 从教师下发 ZIP 恢复 |
| GET | `/workspace/saves` | 存档点列表 |
| POST | `/workspace/saves` | 创建存档点 |
| POST | `/workspace/saves/{id}/load` | 载入存档点 |
| DELETE | `/workspace/saves/{id}` | 删除存档点 |

MVP 当前重点：

- `pack` 用于教师收取作品。
- `restore` 用于教师下发作品包。
- 存档点可保留，但 UI 可简化。

---

### 3.5 `classroom/routes.py`

MVP 关键接口：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/classroom/status` | 教师端扫描状态 |
| POST | `/classroom/app-lock` | 锁屏/解锁 |
| POST | `/classroom/profile/save` | 保存当前作品 |
| POST | `/classroom/profile/submit` | 提交/标记提交 |
| GET | `/classroom/profile/{username}/export` | 导出作品 ZIP |
| POST | `/classroom/profile/files/upload` | 文件分发接收 |
| GET | `/classroom/snapshot` | 缩略图 |

---

## 4. 学生端前端

关键文件：

| 文件 | 作用 |
|------|------|
| `context/classroom-context.tsx` | auth/profile/workspace 全局状态 |
| `components/classroom/login.tsx` | 登录页 |
| `components/classroom/classroom-gate.tsx` | 未登录拦截 |
| `components/classroom/classroom-snapshot-uploader.tsx` | 低频缩略图上传 |

### 4.1 登录必须应用 profile

`createUser` 和 `loginUser` 必须执行：

```ts
await applyCharacterConfig(payload.profile.character_config)
applyWorkspaceState(payload.profile.workspace_state)
```

否则登录后只显示背景，不显示人物。

### 4.2 启动页逻辑

- 调 `/auth/me`。
- 如果 username 为 null，显示登录页。
- 不读历史用户名。
- 不自动登录。

---

## 5. 教师端后端

### 5.1 教师登录

文件：`teacher_console/auth.py`

接口：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前教师 |
| POST | `/api/auth/password` | 改密码 |

默认：`ybszr / 123456`。

---

### 5.2 设备管理与扫描

文件：`teacher_console/app.py`、`student_client.py`

MVP 保留接口：

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/devices` | 设备列表 |
| POST | `/api/devices` | 添加/更新设备 |
| DELETE | `/api/devices/{id}` | 删除设备 |
| POST | `/api/refresh` | 刷新所有设备状态 |
| POST | `/api/devices/{id}/refresh` | 刷新单台 |
| POST | `/api/discover` | 局域网发现 |

状态字段：

- online
- current_username
- locked
- dirty
- submitted
- last_seen
- latency_ms
- last_error

---

### 5.3 锁屏 / 解锁

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/devices/{id}/lock` | 单台锁屏/解锁（body `{locked:true/false}`） |
| POST | `/api/batch/lock` | 批量锁屏/解锁 |

---

### 5.4 文件分发

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/devices/{id}/files/upload` | 单台文件分发 |
| POST | `/api/batch/files/upload` | 批量文件分发 |

MVP：上传到学生端当前用户名的 `files/`。

---

### 5.5 作品收取

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/devices/{id}/collect` | 单台收取 |
| POST | `/api/batch/collect` | 批量收取 |
| POST | `/api/batch/collect-stream` | SSE 进度化收取（后续 UI 可用） |

MVP 注意：

- 收取前应先触发学生端保存。
- 成功返回 path。
- 失败返回 error。

---

### 5.6 作品包下发并应用

MVP 目标接口建议：

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/devices/{id}/workspace/restore` | 向单台下发作品 ZIP 并触发 restore |
| POST | `/api/batch/workspace/restore` | 批量下发作品 ZIP |

当前已有基础：

- 学生端 `/workspace/restore` 已实现。
- 教师端已有普通文件分发接口。

待补：

- 教师端 `student_client.restore_workspace(device, zip_file)`。
- 教师端 UI：选择作品 ZIP → 选设备 → 下发应用。
- 学生端 UI：确认是否载入（当前后端可直接 restore，确认 UI 待补）。

---

## 6. 班级功能处理

MVP 阶段：

- 后端可保留 `/api/classes`、`/api/users`。
- 前端不展示班级管理入口。
- 设备卡片不显示班级、不提供归班。

原因：用户确认班级设计尚未想清楚，先保证最小可用。

后续若重新设计班级，应单独立 PRD。

---

## 7. 树莓派端环境配置

### 7.1 配置模板

使用：`config_templates/conf.classroom.yaml`

特点：

- 只保留课堂所需 ASR/LLM/TTS。
- 不启用服务端 VAD，避免 torch。
- 不保留多余 provider。

### 7.2 一键配置脚本

使用：`deploy/setup_pi.sh`

做的事：

1. 部署 `conf.classroom.yaml` 到 `conf.yaml`。
2. 自动从旧 conf.yaml 继承密钥。
3. 配置 HDMI/DSI 输出。
4. 配置 wm8960 麦克风为默认输入。
5. 配置 wayvnc 自启。

---

## 8. 音频配置

树莓派使用 wm8960 audiohat。

检查命令：

```bash
arecord -l
pactl list short sources
pactl get-default-source
```

默认 source 应为：

```text
alsa_input.platform-soc_107c000000_sound.stereo-fallback
```

录音测试：

```bash
arecord -D hw:2,0 -d 1 -f S16_LE -r 16000 -c 2 /tmp/test_mic.wav
```

---

## 9. GPU / 性能结论

树莓派 5 的 VideoCore VII GPU 不支持通用计算，无法跑 ONNX ASR 推理。

当前 ASR：

```yaml
sherpa_onnx_asr:
  provider: cpu
  num_threads: 4
```

这是合理配置。

---

## 10. 测试基线

学生端：

```cmd
set PYTHONPATH=src
python -m pytest tests/test_classroom_storage.py tests/test_classroom_api.py tests/test_classroom_files.py tests/test_classroom_m2.py -q
```

教师端：

```cmd
set PYTHONPATH=teacher-console
python -m pytest teacher-console/tests/ -q
```

当前基线：

- 学生端 49 passed
- 教师端 37 passed
- 树莓派端到端 smoke_m2.py 27 项通过

---

## 11. 下一步改造清单（按 MVP 优先级）

### P0 必做

1. 教师端作品包下发并触发学生端 `/workspace/restore`。
2. 学生端收到作品包时弹出确认。
3. 教师端收取作品前自动触发学生端保存。
4. 教师端收取结果列表优化。

### P1 可做

1. 缩略图墙 UI。
2. SSE 收集进度条 UI。
3. 离线创建提示条。
4. 作品包导入历史。

### 暂缓

1. 班级管理。
2. 用户全局冲突 UI。
3. 多教师协同。
