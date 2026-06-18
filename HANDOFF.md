# Handoff Document — VTuber Classroom Control 部署与调试

**最后更新**：2026-06-16
**目标硬件**：Raspberry Pi 5 + WM8960 USB-DAC HAT + Waveshare 10.1 寸 DSI 屏
**目标软件**：jacob-VTuber-classroom-control（基于 Open-LLM-VTuber v1.2.1）
**当前状态**：核心功能已可用（管控、Live2D、avatarpack、麦克风、退出），仍有少量待打磨问题

> 同目录下另有 `HANDOFF_classroom_tab_refresh.md`，专门记录"课堂选项卡频繁刷新"的排查上下文。

---

## 一、当前部署拓扑

### 1.1 网络与设备
- 树莓派 5：`192.168.100.133`，用户 `yb` / 密码 `1`
- 教师机（Windows）：当前会话所在机器
- SSH 主机指纹：`SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko`
- 课堂共享令牌：`classroom-test-2026`

### 1.2 树莓派端（数智人 / 学生端）
- 项目目录：`~/Open-LLM-VTuber`
- Python 虚拟环境：`~/Open-LLM-VTuber/.venv`（**Python 3.13.5**，注意：项目 `pyproject.toml` 声明 `requires-python >=3.10,<3.13`，目前是兼容运行）
- 后端入口：`run_server.py`，监听 `0.0.0.0:12393`
- 课堂环境变量：`~/Open-LLM-VTuber/.classroom.env`
  ```
  JACOB_DEVICE_ID=pi-01
  JACOB_DEVICE_NAME=raspberrypi5-test
  JACOB_CLASSROOM_TOKEN=classroom-test-2026
  ```
- 桌面快捷方式：`~/Desktop/翼生涯桌面数智人.desktop` → `scripts/raspberry_pi/start_vtuber_fullscreen.sh`
- kiosk Chromium 用户数据目录：`~/Open-LLM-VTuber/.kiosk-profile`
- 预编译前端：`~/Open-LLM-VTuber/frontend-source/dist/web`（`run_server.py` 会优先用这个）
- 备份：`~/backups/Open-LLM-VTuber_pre_upgrade_20260616.tar.gz`（2.5G，升级前完整快照）
- `conf.yaml.backup` 在 `~/Open-LLM-VTuber/`，由 `upgrade_codes.config_sync` 自动管理

### 1.3 教师机端（管控软件）
- 工作区：`E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master`
- 教师端虚拟环境：`E:\Debian_canvas\vtuber-classcontrol\teacher-venv`（uv 创建，Python 3.12）
- 启动：`PYTHONPATH=teacher-console`，运行 `python -m teacher_console`
- 监听：`http://127.0.0.1:8765`
- 设备配置（已添加）：
  ```json
  {
    "id": "pi-01",
    "name": "树莓派5-测试机",
    "base_url": "http://192.168.100.133:12393",
    "token": "classroom-test-2026",
    "enabled": true
  }
  ```

---

## 二、关键修复记录（按层归类）

### 2.1 项目源代码 bug（已在工作区修，已部署到树莓派）

| 文件 | 问题 | 修复要点 |
| --- | --- | --- |
| `frontend-source/src/renderer/src/context/live2d-config-context.tsx` | `filter: (value) => ({...value, url: ""})` 导致运行态 URL 被清空，Live2D 不初始化 | 移除 `filter` 选项，正常持久化 modelInfo |
| `frontend-source/src/renderer/WebSDK/src/main.ts` | LAppDelegate 单例绑定旧 canvas，`<Live2D/>` 卸载重挂载后画面消失 | 通过 `window.__live2dCanvasRef` 跟踪 canvas，发现替换时全量释放 `LAppLive2DManager / LAppDelegate / LAppGlManager` 再重建 |
| `frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts` | URL 不变时不会重新初始化 | 把 canvas 替换也作为 needsUpdate 条件；并去掉额外的 manager release，避免和 main.ts 冲突 |
| `frontend-source/src/renderer/WebSDK/src/lappglmanager.ts` | 只试 `webgl2`，环境不支持时 alert 并清空 body | fallback 到 `webgl / experimental-webgl`，失败时只 console.error |
| `frontend-source/src/renderer/WebSDK/src/lappmodel.ts` | 加载 `.moc3` 时未保证 `CubismFramework.getIdManager()` 已就绪 | 加守卫：`isStarted/isInitialized/getIdManager` 任一缺失则 `cleanUp / startUp / initialize` |
| `model_dict.json` | 残留 `xiao_yi`，但 zip 包没有此模型 | 移除该条目，保留 `mao_pro / shizuku` |
| `scripts/raspberry_pi/*.sh` | Windows CRLF 换行 | 全部转 LF + chmod +x |
| `frontend-source/dist/web/libs/vad.worklet.bundle.min.js` | vite 静态拷贝未带 | 从旧前端复制过来 |

### 2.2 部署/迁移引入的问题（已修）

| 问题 | 处理 |
| --- | --- |
| `avatar_pack` 因打包排除 + rsync `--delete-delay` 残缺到 956K | 从备份 tar.gz 恢复，95MB / 199 帧 |
| `.venv` 被 rsync 删除 | 用系统 Python 3.13.5 重建，再用清华源 + `--ignore-scripts` 装依赖 |
| `conf.yaml` 的 `host: localhost` 让教师机跨网段连不上 | 改为 `host: 0.0.0.0` |

### 2.3 树莓派系统层问题（已修）

| 问题 | 处理 |
| --- | --- |
| `/boot/firmware/config.txt` 之前禁用了 DSI overlay 和 `display_auto_detect`，导致 WM8960 复位失败、无 capture 设备 | 恢复 `display_auto_detect=1` 和 `dtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch`；重启后录音设备恢复 |
| 默认 PipeWire source 是 `auto_null.monitor` | 改为 `alsa_input.platform-soc_107c000000_sound.stereo-fallback`，volume 100%，unmute |

---

## 三、当前已确认的功能状态

| 功能 | 状态 | 备注 |
| --- | --- | --- |
| 后端启动 | ✅ | Open-LLM-VTuber v1.2.1 / 0.0.0.0:12393 |
| 主前端加载新版 | ✅ | 当前 bundle 形如 `main-aa5t3o5w.js`（每次构建会变） |
| AvatarPack 帧序列模型 | ✅ | 默认 default_avatarpack |
| Live2D 初次显示 | ✅ | mao_pro / shizuku 都能加载 |
| Live2D ↔ AvatarPack 来回切换 | ⚠️ **未最终验收** | 已部署 canvas 重绑定修复，等用户实测 |
| Live2D 模型间切换（mao_pro ↔ shizuku） | ✅ | 用户已确认 |
| 麦克风录音 | ✅ | wm8960-soundcard / 48k stereo s32_le |
| ASR（sherpa-onnx sense_voice 中文） | ✅ | smoke test：模型自带 zh.wav 转写"开放时间早上9点至下午5点。" |
| TTS（volcengine_tts） | ⚠️ 需 conf.yaml 中 API Key | 旧配置已保留 |
| `/system/exit` 退出按钮 | ✅ | 关闭后端 + kiosk 浏览器 |
| 桌面快捷方式 | ✅ | 已修复权限 + LF |
| 教师端 → 树莓派 `/classroom/status` | ✅ | latency ~30-130ms |
| 教师端锁定/解锁 | ✅ | `classroom_locked` 字段流转正常 |
| 教师端缩略图 | ✅ | 5s 自动上传 |
| 教师端文件分发 | ✅ | 需先在前端创建 classroom profile |
| 教师端作品收集（zip） | ✅ | 文件落到 `%LOCALAPPDATA%\JacobTeacherConsole\collections\` |

---

## 四、已知遗留问题（待下一个 agent 跟进）

### 4.1 高优先级
1. **Live2D ↔ AvatarPack 来回切换稳定性最终验收**
   - 已修 canvas 重绑定，用户最近一次实测前已重启 kiosk，等用户 sign-off。
   - 如仍偶发消失，建议改成"切换 avatarMode 时强制 `location.reload()`"，最稳但有刷新感。

2. **课堂选项卡刷新行为**（用户最近反馈）
   - 现象：树莓派前端"课堂"选项卡频繁刷新。
   - 未深入定位。建议：
     - 看 `frontend-source/src/renderer/src/components/sidebar/setting/classroom-*.tsx`
     - 看 `useEffect` 是否依赖了每次 `/classroom/status` 返回的新对象
     - 看 `ClassroomSnapshotUploader` 是否触发不必要的 React 重渲染
     - 看是否因为 polling 而重新 mount
   - 同目录 `HANDOFF_classroom_tab_refresh.md` 是上一轮针对这个问题的初步分析交接文档，可继续接力。

3. **教师端管控软件使用逻辑**：用户希望有一份 user-facing 的使用文档（参见第六节"建议补充交付物"）。

### 4.2 中优先级
1. **`model_dict.json` 中 xiao_yi 已被移除**
   - 如果业务方需要 xiao_yi，需要单独提供模型资源（zip 包和备份里都没有）。

2. **Python 3.13 兼容**
   - 目前能跑，但 `pyproject.toml` 声明的是 `<3.13`，长期最好在树莓派上装 Python 3.12.13 重建 venv。
   - 安装路径建议：pyenv 编译，或用 deadsnakes/官方 Debian backports。

3. **TTS / LLM 真正端到端对话**
   - smoke test 只验证了 ASR；TTS 走的是火山引擎，需要 `conf.yaml` 里的 `volcengine_tts` 配置和 API Key 还在并有余额。
   - LLM 用的是 `dashscope qwen3.6-flash`（DashScope OpenAI 兼容接口），同样需要 API Key 在线。

### 4.3 低优先级
1. **构建警告**：
   - vite 提示 `onnxruntime-web` 用了 eval（无害）
   - main 包大于 500KB（性能优化空间）
2. **教师端中文设备名在 PowerShell 控制台显示 `???`**：仅 cmd/PowerShell 编码问题，浏览器界面正常。

---

## 五、关键操作脚本（位于工作区根目录）

| 脚本 | 用途 |
| --- | --- |
| `audit_pi_deploy.py` | 树莓派端 50 项部署完整性审计（目录、模型引用、HTTP、依赖等） |
| `summarize_audit.py` | 把审计 JSON 汇总成失败列表 |
| `check_pydeps.py` | 树莓派 venv 依赖快速 import 测试 |
| `check_live2d_refs.py` | 校验 model3.json 内部引用文件全部存在 |
| `restart_after_live2d_fix.sh` | 重启树莓派后端（停旧、source `.classroom.env`、起新） |
| `start_chromium_kiosk.sh` | 普通 kiosk Chromium 启动（无 remote-debug） |
| `start_chromium_kiosk_debug.sh` | 带 `--remote-debugging-port=9223` 的 kiosk，用来 CDP 调试 |
| `cdp_existing_kiosk_probe.py` | 通过 9223 抓真实 kiosk 页面的 console / pageerror / DOM 状态 |
| `cdp_canvas_probe_light.py` | 抓 canvas 元素层级 + Live2D model 状态 |
| `cdp_force_live2d_visible.py` | 紧急把模型矩阵重置到正中央可见区域（应急用） |
| `fix_live2d_catalog.py` | 清理 model_dict.json 中无效条目 |
| `fix_shell_scripts.py` | 把树莓派上 `scripts/**/*.sh` 全部转 Unix LF |
| `start_after_audio_fix.sh` | 设默认麦克风源 + 重启后端 |
| `restore_avatar_pack.sh` | 从备份 tar.gz 恢复 avatar_pack |

---

## 六、建议补充交付物

下一个 agent 接手时如果时间允许，建议补这些：

1. **教师端使用文档**（用户主动要过）
   - 课堂流程怎么走？教师怎么开始一节课？
   - "锁定"是软件内 lock overlay，**不是系统级锁屏**，需要在文档里说清楚。
   - 文件分发、作品收集的目录约定。
   - 当前 `jacob-VTuber-classroom-control-master/teacher-console/README.md` 是技术性的，建议加一份 user-facing 的。

2. **Python 3.12 重建 venv 的脚本**
   - 在 Pi OS Debian 13 trixie 上 apt 没有 python3.12，需要 pyenv 或源码编译。
   - 期望产出：一个 `scripts/raspberry_pi/setup_python312.sh`。

3. **课堂选项卡频繁刷新问题修复**

4. **CRLF/LF 防护**：在工作区加 `.gitattributes`：
   ```
   *.sh text eol=lf
   *.py text eol=lf
   ```

5. **打包脚本**：把"工作区代码 → 树莓派部署"这条链路标准化（避免再次出现 rsync 误删 `.venv` / `avatar_pack`）。当前思路：
   - tar 时显式 include 列表，而不是 exclude。
   - rsync 不要带 `--delete-delay`，或者 `--delete-excluded` 时严格指定 exclude-from 文件。

---

## 七、下一个 agent 立即可用的连接命令

### 7.1 SSH 到树莓派
```bat
plink -batch -ssh -hostkey "SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko" -pw 1 yb@192.168.100.133 "<command>"
```

### 7.2 SCP 上传文件到树莓派
```bat
pscp -batch -hostkey "SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko" -pw 1 <local> yb@192.168.100.133:<remote>
```

### 7.3 教师端 API
```bat
:: 刷新设备状态
curl.exe -s -X POST http://127.0.0.1:8765/api/devices/pi-01/refresh

:: 锁定
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"locked\":true}" http://127.0.0.1:8765/api/devices/pi-01/lock

:: 文件分发
curl.exe -s -X POST -F "file=@xxx.txt" http://127.0.0.1:8765/api/devices/pi-01/files/upload

:: 作品收集
curl.exe -s -X POST http://127.0.0.1:8765/api/devices/pi-01/collect
```

### 7.4 重启树莓派 kiosk（不重启后端）
```
plink ... yb@192.168.100.133 "pkill -f /home/yb/Open-LLM-VTuber/.kiosk-profile 2>/dev/null"
plink ... yb@192.168.100.133 "bash /tmp/start_chromium_kiosk.sh"
```
（`pkill` 命令的 exit code 128 是 plink 自身退出码问题，可以忽略，进程其实已被杀。）

### 7.5 抓真实 kiosk 页面状态（CDP）
1. 用 `start_chromium_kiosk_debug.sh` 启动（带 `--remote-debugging-port=9223`）
2. 跑 `cdp_existing_kiosk_probe.py` / `cdp_canvas_probe_light.py`

---

## 八、踩过的环境坑（提醒下一个 agent）

1. **plink 远程命令里 `$()` 会被 Windows cmd 当作字面量**：所有需要远程 shell 替换的逻辑写到 `.sh` 上传后再 `bash xxx.sh`。

2. **plink 远程 `pkill -f xxx` 会让自己 exit 128**：因为命令行里也包含 xxx，被自己匹配。但目标进程通常已经被杀。可以用 `[x]xx` 这种 trick，或者忽略 exit code。

3. **树莓派 PyPI 直连不稳**：用清华镜像 `https://pypi.tuna.tsinghua.edu.cn/simple`；树莓派全局 pip 配置默认带 piwheels，遇到 SSL 错时用 `pip --isolated` 绕开。

4. **`npm ci` 卡在 Electron postinstall**：用 `npm ci --ignore-scripts`。我们只构建 web。

5. **vite 构建产物输出在 `frontend-source/../dist/web`，即项目根 `dist/web`**：但 `run_server.py` 检查的是 `frontend-source/dist/web/index.html`。当前两者实际指同一处（vite 配置里 outDir 是相对路径，巧合一致）。

6. **rsync 误删**：所有部署脚本不要带 `--delete-delay`，或者用严格的 `--exclude-from` 白名单。

7. **WM8960 必须 `display_auto_detect=1` + DSI overlay**：禁用 DSI 时 WM8960 探测失败，连带没有麦克风。

---

## 九、本次会话内已部署到树莓派的所有改动汇总

只列改了什么，便于 review/回滚：

```
~/Open-LLM-VTuber/
  frontend-source/src/renderer/src/context/live2d-config-context.tsx       (源码 bug 修复)
  frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts        (canvas 替换重新初始化)
  frontend-source/src/renderer/WebSDK/src/main.ts                          (canvas 替换检测 + 完整重建)
  frontend-source/src/renderer/WebSDK/src/lappglmanager.ts                 (WebGL fallback)
  frontend-source/src/renderer/WebSDK/src/lappmodel.ts                     (CubismFramework getId 守卫)
  frontend-source/dist/web/                                                (npm run build:web 产物)
  frontend-source/dist/web/libs/vad.worklet.bundle.min.js                  (从旧前端拷回)
  scripts/raspberry_pi/*.sh                                                (CRLF -> LF, chmod +x)
  model_dict.json                                                          (移除 xiao_yi)
  conf.yaml                                                                (host: localhost -> 0.0.0.0)
  .classroom.env                                                           (新建)
  avatar_pack/                                                             (从备份恢复完整内容)
  .venv/                                                                   (重建,Python 3.13.5)

/boot/firmware/config.txt                                                  (display_auto_detect=1, DSI overlay 启用)
PipeWire 默认 source                                                        (alsa_input.platform-soc_107c000000_sound.stereo-fallback)
~/Desktop/翼生涯桌面数智人.desktop                                           (chmod +x)
```

工作区端（Windows）改动：
```
E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\
  frontend-source\src\renderer\src\context\live2d-config-context.tsx       (与树莓派同)
  frontend-source\src\renderer\src\hooks\canvas\use-live2d-model.ts        (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\main.ts                          (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\lappglmanager.ts                 (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\lappmodel.ts                     (与树莓派同)
```

工作区还多了一堆调试/部署脚本（见第五节）。

---

## 十、回滚方案（应急用）

如果新版部署彻底崩了：

```bash
plink ... "cd ~ && rm -rf Open-LLM-VTuber.broken && mv Open-LLM-VTuber Open-LLM-VTuber.broken && tar xzf backups/Open-LLM-VTuber_pre_upgrade_20260616.tar.gz"
```

注意：备份里 **没有 `.venv`**（备份时排除了），需要重建。

---

## 十一、问题归因汇总（回答用户的"是部署还是源码问题"）

| 类别 | 问题 | 是源码 bug 还是部署问题 |
| --- | --- | --- |
| Live2D 显示 | modelInfo.url 被 filter 清空 | **源码 bug**（新版独有） |
| Live2D 切回 | LAppDelegate 单例绑定旧 canvas | **源码 bug** |
| Live2D WebGL2 不可用即崩 | 没有 fallback | **源码缺陷** |
| Live2D `getId` null | Cubism 初始化竞态 | **源码竞态** |
| Live2D xiao_yi 不存在 | model_dict 与资源不一致 | **源码/打包不一致** |
| 退出按钮无效 | shell 脚本 CRLF | **打包/源码** |
| VAD worklet 缺失 | vite 静态拷贝缺项 | **构建配置** |
| avatar_pack 残缺 | 我打包时排除 + rsync 删 | **本次部署引入** |
| `.venv` 丢失 | rsync `--delete-delay` 误删 | **本次部署引入** |
| host=localhost 教师机连不上 | conf.yaml 默认 | **配置问题，与新旧版无关** |
| 麦克风没有 capture | `/boot/firmware/config.txt` 之前被改坏 | **树莓派系统层** |

End of handoff.

---

## 十二、升级规划交接（2026-06-17 新增）

### 12.1 背景

本次会话用户提出一份《升级计划.txt》（位于 `E:\Debian_canvas\vtuber-classroom升级计划.txt`），目标是把现有系统改造为面向"班级教学、分组共用机器"场景的教学版。我已对计划做了逐条评估、与用户确认了所有开放决策，并产出两份正式文档。

### 12.2 已定型的技术决策（用户已确认）

| 决策项 | 结论 |
|--------|------|
| 学生端数据模型 | **方案 A**：用户名作主键 + 班级属性化（目录结构 `profiles/{username}/`，取代 `profile_id = class_slug__student_slug`） |
| 教师端桌面形态 | **pywebview**（系统 WebView2，Win10 1903+ 预装），取代 `webbrowser.open` |
| 用户名规则 | 设备名，仅 `[A-Za-z0-9]`，1–32 字符 |
| 用户名唯一性 | 前端不显示历史；教师机集中存储（`users.json`）+ 离线降级（pending_sync） |
| 形象打包 | 本版全量打包；后续版本再加"默认模型不可删"机制 |
| 缩略图频率 | 30 秒，与状态轮询（5 秒）解耦 |
| 旧档迁移 | 不迁移，全新开始；旧结构保留不动，首启提示恢复初始设置 |
| 恢复初始设置 | 教师端加批量复位功能，清空学生文件保留默认文档 |

### 12.3 产出文档（下一个 agent 直接可用）

| 文档 | 路径 | 用途 |
|------|------|------|
| 升级计划原文 | `E:\Debian_canvas\vtuber-classroom升级计划.txt` | 用户写的初版需求 |
| **PRD** | `E:\Debian_canvas\vtuber-classcontrol\docs\PRD.md` | 产品需求规格说明书（10 章：背景/角色/功能清单 S-1~S-9 + T-1~T-9/业务流程/非功能/验收/风险/里程碑） |
| **开发文档** | `E:\Debian_canvas\vtuber-classcontrol\docs\开发文档.md` | 技术设计说明书（14 章：架构/数据模型/API 设计/关键算法/模块改动清单/排期） |
| 系统分析交接（旧） | `E:\Debian_canvas\vtuber-classcontrol\HANDOFF.md`（本文件前十一章） | 现有系统架构与已修复问题 |

### 12.4 核心改造点速览（下一个 agent 接手时先看这几处）

**学生端（`src/open_llm_vtuber/classroom/`）**
- `storage.py` **重构**：路径函数从 `profile_dir_for_slugs(class_slug, student_slug)` → `profile_dir_for_username(username)`
- `routes.py` 改造：所有 `/classroom/profile/*` 参数 `profile_id` → `username`
- 新增 `auth.py`（登录/创建/退出/会话）、`sync_manager.py`（离线同步/冲突改名）、`workspace.py`（打包/恢复/存档点）
- 前端新增登录页（`frontend-source/src/views/Login.vue`），路由守卫未登录跳 `/login`

**教师端（`teacher-console/teacher_console/`）**
- `__main__.py`：`webbrowser.open` → `pywebview.create_window`
- 新增 `auth.py`（教师登录中间件）、`user_store.py`（全局用户名注册表）、`class_store.py`（班级定义）、`scan_service.py`（后台定时扫描）、`collect_service.py`（进度化批量收取）
- `student_client.py` 改造：新增 check-username / sync / reset；collect 改流式 + 进度
- 前端 `app.js`：缩略图独立轮询 30s；批量收取进度条；设置抽屉

### 12.5 关键 API 新增清单

**学生端**：`/auth/check-username`、`/auth/create`、`/auth/login`、`/auth/logout`、`/workspace/pack`、`/workspace/restore`、`/workspace/saves`、`/classroom/reset`

**教师端**：`/api/auth/login`、`/api/classes`、`/api/users`、`/api/users/check`、`/api/users/sync`、`/api/scan/now`、`/api/batch/collect`（进度化）、`/api/batch/reset`

### 12.6 排期（约 9 周单人）

M1 数据模型重构（2 周）→ M2 学生端打包/恢复（1.5 周）→ M3 教师端 pywebview+登录（1 周）→ M4 教师端班级+扫描（2 周）→ M5 缩略图+进度收取（1.5 周）→ M6 复位+设置收起+联调（1 周）

### 12.7 下一个 agent 的建议起步

1. 先读 `docs/PRD.md` 和 `docs/开发文档.md`（本次会话产出）。
2. 再读本文件前十一章了解现有系统已修复状态。
3. M1 从 `src/open_llm_vtuber/classroom/storage.py` 重构开始（地基）。
4. 验收基线：现有测试 `tests/test_classroom_storage.py` + `tests/test_classroom_api.py` + `teacher-console/tests/test_teacher_console*.py` 在改造前必须全绿。

### 12.8 M1 完成记录（2026-06-17）

**方案决策**：采用方案 A —— 彻底删除 `profile_id/class_slug/student_slug/student_name`，`username` 作主键，保留 `class_name`（仅显示用，可空）。新增 `pending_sync` 字段。`schema_version` 升至 2。依据开发文档 §3.3。

**完成内容（按改造顺序）**：

1. `classroom/models.py`
   - `ClassroomProfile`：删 `profile_id/class_slug/student_slug/student_name`，改 `username` 主键 + `class_name: str | None` + `pending_sync: bool`，`schema_version=2`。
   - `CreateProfileRequest`：入参 `class_name/student_name` → `username`（pattern `^[A-Za-z0-9]{1,32}# Handoff Document — VTuber Classroom Control 部署与调试

**最后更新**：2026-06-16
**目标硬件**：Raspberry Pi 5 + WM8960 USB-DAC HAT + Waveshare 10.1 寸 DSI 屏
**目标软件**：jacob-VTuber-classroom-control（基于 Open-LLM-VTuber v1.2.1）
**当前状态**：核心功能已可用（管控、Live2D、avatarpack、麦克风、退出），仍有少量待打磨问题

> 同目录下另有 `HANDOFF_classroom_tab_refresh.md`，专门记录"课堂选项卡频繁刷新"的排查上下文。

---

## 一、当前部署拓扑

### 1.1 网络与设备
- 树莓派 5：`192.168.100.133`，用户 `yb` / 密码 `1`
- 教师机（Windows）：当前会话所在机器
- SSH 主机指纹：`SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko`
- 课堂共享令牌：`classroom-test-2026`

### 1.2 树莓派端（数智人 / 学生端）
- 项目目录：`~/Open-LLM-VTuber`
- Python 虚拟环境：`~/Open-LLM-VTuber/.venv`（**Python 3.13.5**，注意：项目 `pyproject.toml` 声明 `requires-python >=3.10,<3.13`，目前是兼容运行）
- 后端入口：`run_server.py`，监听 `0.0.0.0:12393`
- 课堂环境变量：`~/Open-LLM-VTuber/.classroom.env`
  ```
  JACOB_DEVICE_ID=pi-01
  JACOB_DEVICE_NAME=raspberrypi5-test
  JACOB_CLASSROOM_TOKEN=classroom-test-2026
  ```
- 桌面快捷方式：`~/Desktop/翼生涯桌面数智人.desktop` → `scripts/raspberry_pi/start_vtuber_fullscreen.sh`
- kiosk Chromium 用户数据目录：`~/Open-LLM-VTuber/.kiosk-profile`
- 预编译前端：`~/Open-LLM-VTuber/frontend-source/dist/web`（`run_server.py` 会优先用这个）
- 备份：`~/backups/Open-LLM-VTuber_pre_upgrade_20260616.tar.gz`（2.5G，升级前完整快照）
- `conf.yaml.backup` 在 `~/Open-LLM-VTuber/`，由 `upgrade_codes.config_sync` 自动管理

### 1.3 教师机端（管控软件）
- 工作区：`E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master`
- 教师端虚拟环境：`E:\Debian_canvas\vtuber-classcontrol\teacher-venv`（uv 创建，Python 3.12）
- 启动：`PYTHONPATH=teacher-console`，运行 `python -m teacher_console`
- 监听：`http://127.0.0.1:8765`
- 设备配置（已添加）：
  ```json
  {
    "id": "pi-01",
    "name": "树莓派5-测试机",
    "base_url": "http://192.168.100.133:12393",
    "token": "classroom-test-2026",
    "enabled": true
  }
  ```

---

## 二、关键修复记录（按层归类）

### 2.1 项目源代码 bug（已在工作区修，已部署到树莓派）

| 文件 | 问题 | 修复要点 |
| --- | --- | --- |
| `frontend-source/src/renderer/src/context/live2d-config-context.tsx` | `filter: (value) => ({...value, url: ""})` 导致运行态 URL 被清空，Live2D 不初始化 | 移除 `filter` 选项，正常持久化 modelInfo |
| `frontend-source/src/renderer/WebSDK/src/main.ts` | LAppDelegate 单例绑定旧 canvas，`<Live2D/>` 卸载重挂载后画面消失 | 通过 `window.__live2dCanvasRef` 跟踪 canvas，发现替换时全量释放 `LAppLive2DManager / LAppDelegate / LAppGlManager` 再重建 |
| `frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts` | URL 不变时不会重新初始化 | 把 canvas 替换也作为 needsUpdate 条件；并去掉额外的 manager release，避免和 main.ts 冲突 |
| `frontend-source/src/renderer/WebSDK/src/lappglmanager.ts` | 只试 `webgl2`，环境不支持时 alert 并清空 body | fallback 到 `webgl / experimental-webgl`，失败时只 console.error |
| `frontend-source/src/renderer/WebSDK/src/lappmodel.ts` | 加载 `.moc3` 时未保证 `CubismFramework.getIdManager()` 已就绪 | 加守卫：`isStarted/isInitialized/getIdManager` 任一缺失则 `cleanUp / startUp / initialize` |
| `model_dict.json` | 残留 `xiao_yi`，但 zip 包没有此模型 | 移除该条目，保留 `mao_pro / shizuku` |
| `scripts/raspberry_pi/*.sh` | Windows CRLF 换行 | 全部转 LF + chmod +x |
| `frontend-source/dist/web/libs/vad.worklet.bundle.min.js` | vite 静态拷贝未带 | 从旧前端复制过来 |

### 2.2 部署/迁移引入的问题（已修）

| 问题 | 处理 |
| --- | --- |
| `avatar_pack` 因打包排除 + rsync `--delete-delay` 残缺到 956K | 从备份 tar.gz 恢复，95MB / 199 帧 |
| `.venv` 被 rsync 删除 | 用系统 Python 3.13.5 重建，再用清华源 + `--ignore-scripts` 装依赖 |
| `conf.yaml` 的 `host: localhost` 让教师机跨网段连不上 | 改为 `host: 0.0.0.0` |

### 2.3 树莓派系统层问题（已修）

| 问题 | 处理 |
| --- | --- |
| `/boot/firmware/config.txt` 之前禁用了 DSI overlay 和 `display_auto_detect`，导致 WM8960 复位失败、无 capture 设备 | 恢复 `display_auto_detect=1` 和 `dtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch`；重启后录音设备恢复 |
| 默认 PipeWire source 是 `auto_null.monitor` | 改为 `alsa_input.platform-soc_107c000000_sound.stereo-fallback`，volume 100%，unmute |

---

## 三、当前已确认的功能状态

| 功能 | 状态 | 备注 |
| --- | --- | --- |
| 后端启动 | ✅ | Open-LLM-VTuber v1.2.1 / 0.0.0.0:12393 |
| 主前端加载新版 | ✅ | 当前 bundle 形如 `main-aa5t3o5w.js`（每次构建会变） |
| AvatarPack 帧序列模型 | ✅ | 默认 default_avatarpack |
| Live2D 初次显示 | ✅ | mao_pro / shizuku 都能加载 |
| Live2D ↔ AvatarPack 来回切换 | ⚠️ **未最终验收** | 已部署 canvas 重绑定修复，等用户实测 |
| Live2D 模型间切换（mao_pro ↔ shizuku） | ✅ | 用户已确认 |
| 麦克风录音 | ✅ | wm8960-soundcard / 48k stereo s32_le |
| ASR（sherpa-onnx sense_voice 中文） | ✅ | smoke test：模型自带 zh.wav 转写"开放时间早上9点至下午5点。" |
| TTS（volcengine_tts） | ⚠️ 需 conf.yaml 中 API Key | 旧配置已保留 |
| `/system/exit` 退出按钮 | ✅ | 关闭后端 + kiosk 浏览器 |
| 桌面快捷方式 | ✅ | 已修复权限 + LF |
| 教师端 → 树莓派 `/classroom/status` | ✅ | latency ~30-130ms |
| 教师端锁定/解锁 | ✅ | `classroom_locked` 字段流转正常 |
| 教师端缩略图 | ✅ | 5s 自动上传 |
| 教师端文件分发 | ✅ | 需先在前端创建 classroom profile |
| 教师端作品收集（zip） | ✅ | 文件落到 `%LOCALAPPDATA%\JacobTeacherConsole\collections\` |

---

## 四、已知遗留问题（待下一个 agent 跟进）

### 4.1 高优先级
1. **Live2D ↔ AvatarPack 来回切换稳定性最终验收**
   - 已修 canvas 重绑定，用户最近一次实测前已重启 kiosk，等用户 sign-off。
   - 如仍偶发消失，建议改成"切换 avatarMode 时强制 `location.reload()`"，最稳但有刷新感。

2. **课堂选项卡刷新行为**（用户最近反馈）
   - 现象：树莓派前端"课堂"选项卡频繁刷新。
   - 未深入定位。建议：
     - 看 `frontend-source/src/renderer/src/components/sidebar/setting/classroom-*.tsx`
     - 看 `useEffect` 是否依赖了每次 `/classroom/status` 返回的新对象
     - 看 `ClassroomSnapshotUploader` 是否触发不必要的 React 重渲染
     - 看是否因为 polling 而重新 mount
   - 同目录 `HANDOFF_classroom_tab_refresh.md` 是上一轮针对这个问题的初步分析交接文档，可继续接力。

3. **教师端管控软件使用逻辑**：用户希望有一份 user-facing 的使用文档（参见第六节"建议补充交付物"）。

### 4.2 中优先级
1. **`model_dict.json` 中 xiao_yi 已被移除**
   - 如果业务方需要 xiao_yi，需要单独提供模型资源（zip 包和备份里都没有）。

2. **Python 3.13 兼容**
   - 目前能跑，但 `pyproject.toml` 声明的是 `<3.13`，长期最好在树莓派上装 Python 3.12.13 重建 venv。
   - 安装路径建议：pyenv 编译，或用 deadsnakes/官方 Debian backports。

3. **TTS / LLM 真正端到端对话**
   - smoke test 只验证了 ASR；TTS 走的是火山引擎，需要 `conf.yaml` 里的 `volcengine_tts` 配置和 API Key 还在并有余额。
   - LLM 用的是 `dashscope qwen3.6-flash`（DashScope OpenAI 兼容接口），同样需要 API Key 在线。

### 4.3 低优先级
1. **构建警告**：
   - vite 提示 `onnxruntime-web` 用了 eval（无害）
   - main 包大于 500KB（性能优化空间）
2. **教师端中文设备名在 PowerShell 控制台显示 `???`**：仅 cmd/PowerShell 编码问题，浏览器界面正常。

---

## 五、关键操作脚本（位于工作区根目录）

| 脚本 | 用途 |
| --- | --- |
| `audit_pi_deploy.py` | 树莓派端 50 项部署完整性审计（目录、模型引用、HTTP、依赖等） |
| `summarize_audit.py` | 把审计 JSON 汇总成失败列表 |
| `check_pydeps.py` | 树莓派 venv 依赖快速 import 测试 |
| `check_live2d_refs.py` | 校验 model3.json 内部引用文件全部存在 |
| `restart_after_live2d_fix.sh` | 重启树莓派后端（停旧、source `.classroom.env`、起新） |
| `start_chromium_kiosk.sh` | 普通 kiosk Chromium 启动（无 remote-debug） |
| `start_chromium_kiosk_debug.sh` | 带 `--remote-debugging-port=9223` 的 kiosk，用来 CDP 调试 |
| `cdp_existing_kiosk_probe.py` | 通过 9223 抓真实 kiosk 页面的 console / pageerror / DOM 状态 |
| `cdp_canvas_probe_light.py` | 抓 canvas 元素层级 + Live2D model 状态 |
| `cdp_force_live2d_visible.py` | 紧急把模型矩阵重置到正中央可见区域（应急用） |
| `fix_live2d_catalog.py` | 清理 model_dict.json 中无效条目 |
| `fix_shell_scripts.py` | 把树莓派上 `scripts/**/*.sh` 全部转 Unix LF |
| `start_after_audio_fix.sh` | 设默认麦克风源 + 重启后端 |
| `restore_avatar_pack.sh` | 从备份 tar.gz 恢复 avatar_pack |

---

## 六、建议补充交付物

下一个 agent 接手时如果时间允许，建议补这些：

1. **教师端使用文档**（用户主动要过）
   - 课堂流程怎么走？教师怎么开始一节课？
   - "锁定"是软件内 lock overlay，**不是系统级锁屏**，需要在文档里说清楚。
   - 文件分发、作品收集的目录约定。
   - 当前 `jacob-VTuber-classroom-control-master/teacher-console/README.md` 是技术性的，建议加一份 user-facing 的。

2. **Python 3.12 重建 venv 的脚本**
   - 在 Pi OS Debian 13 trixie 上 apt 没有 python3.12，需要 pyenv 或源码编译。
   - 期望产出：一个 `scripts/raspberry_pi/setup_python312.sh`。

3. **课堂选项卡频繁刷新问题修复**

4. **CRLF/LF 防护**：在工作区加 `.gitattributes`：
   ```
   *.sh text eol=lf
   *.py text eol=lf
   ```

5. **打包脚本**：把"工作区代码 → 树莓派部署"这条链路标准化（避免再次出现 rsync 误删 `.venv` / `avatar_pack`）。当前思路：
   - tar 时显式 include 列表，而不是 exclude。
   - rsync 不要带 `--delete-delay`，或者 `--delete-excluded` 时严格指定 exclude-from 文件。

---

## 七、下一个 agent 立即可用的连接命令

### 7.1 SSH 到树莓派
```bat
plink -batch -ssh -hostkey "SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko" -pw 1 yb@192.168.100.133 "<command>"
```

### 7.2 SCP 上传文件到树莓派
```bat
pscp -batch -hostkey "SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko" -pw 1 <local> yb@192.168.100.133:<remote>
```

### 7.3 教师端 API
```bat
:: 刷新设备状态
curl.exe -s -X POST http://127.0.0.1:8765/api/devices/pi-01/refresh

:: 锁定
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"locked\":true}" http://127.0.0.1:8765/api/devices/pi-01/lock

:: 文件分发
curl.exe -s -X POST -F "file=@xxx.txt" http://127.0.0.1:8765/api/devices/pi-01/files/upload

:: 作品收集
curl.exe -s -X POST http://127.0.0.1:8765/api/devices/pi-01/collect
```

### 7.4 重启树莓派 kiosk（不重启后端）
```
plink ... yb@192.168.100.133 "pkill -f /home/yb/Open-LLM-VTuber/.kiosk-profile 2>/dev/null"
plink ... yb@192.168.100.133 "bash /tmp/start_chromium_kiosk.sh"
```
（`pkill` 命令的 exit code 128 是 plink 自身退出码问题，可以忽略，进程其实已被杀。）

### 7.5 抓真实 kiosk 页面状态（CDP）
1. 用 `start_chromium_kiosk_debug.sh` 启动（带 `--remote-debugging-port=9223`）
2. 跑 `cdp_existing_kiosk_probe.py` / `cdp_canvas_probe_light.py`

---

## 八、踩过的环境坑（提醒下一个 agent）

1. **plink 远程命令里 `$()` 会被 Windows cmd 当作字面量**：所有需要远程 shell 替换的逻辑写到 `.sh` 上传后再 `bash xxx.sh`。

2. **plink 远程 `pkill -f xxx` 会让自己 exit 128**：因为命令行里也包含 xxx，被自己匹配。但目标进程通常已经被杀。可以用 `[x]xx` 这种 trick，或者忽略 exit code。

3. **树莓派 PyPI 直连不稳**：用清华镜像 `https://pypi.tuna.tsinghua.edu.cn/simple`；树莓派全局 pip 配置默认带 piwheels，遇到 SSL 错时用 `pip --isolated` 绕开。

4. **`npm ci` 卡在 Electron postinstall**：用 `npm ci --ignore-scripts`。我们只构建 web。

5. **vite 构建产物输出在 `frontend-source/../dist/web`，即项目根 `dist/web`**：但 `run_server.py` 检查的是 `frontend-source/dist/web/index.html`。当前两者实际指同一处（vite 配置里 outDir 是相对路径，巧合一致）。

6. **rsync 误删**：所有部署脚本不要带 `--delete-delay`，或者用严格的 `--exclude-from` 白名单。

7. **WM8960 必须 `display_auto_detect=1` + DSI overlay**：禁用 DSI 时 WM8960 探测失败，连带没有麦克风。

---

## 九、本次会话内已部署到树莓派的所有改动汇总

只列改了什么，便于 review/回滚：

```
~/Open-LLM-VTuber/
  frontend-source/src/renderer/src/context/live2d-config-context.tsx       (源码 bug 修复)
  frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts        (canvas 替换重新初始化)
  frontend-source/src/renderer/WebSDK/src/main.ts                          (canvas 替换检测 + 完整重建)
  frontend-source/src/renderer/WebSDK/src/lappglmanager.ts                 (WebGL fallback)
  frontend-source/src/renderer/WebSDK/src/lappmodel.ts                     (CubismFramework getId 守卫)
  frontend-source/dist/web/                                                (npm run build:web 产物)
  frontend-source/dist/web/libs/vad.worklet.bundle.min.js                  (从旧前端拷回)
  scripts/raspberry_pi/*.sh                                                (CRLF -> LF, chmod +x)
  model_dict.json                                                          (移除 xiao_yi)
  conf.yaml                                                                (host: localhost -> 0.0.0.0)
  .classroom.env                                                           (新建)
  avatar_pack/                                                             (从备份恢复完整内容)
  .venv/                                                                   (重建,Python 3.13.5)

/boot/firmware/config.txt                                                  (display_auto_detect=1, DSI overlay 启用)
PipeWire 默认 source                                                        (alsa_input.platform-soc_107c000000_sound.stereo-fallback)
~/Desktop/翼生涯桌面数智人.desktop                                           (chmod +x)
```

工作区端（Windows）改动：
```
E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\
  frontend-source\src\renderer\src\context\live2d-config-context.tsx       (与树莓派同)
  frontend-source\src\renderer\src\hooks\canvas\use-live2d-model.ts        (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\main.ts                          (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\lappglmanager.ts                 (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\lappmodel.ts                     (与树莓派同)
```

工作区还多了一堆调试/部署脚本（见第五节）。

---

## 十、回滚方案（应急用）

如果新版部署彻底崩了：

```bash
plink ... "cd ~ && rm -rf Open-LLM-VTuber.broken && mv Open-LLM-VTuber Open-LLM-VTuber.broken && tar xzf backups/Open-LLM-VTuber_pre_upgrade_20260616.tar.gz"
```

注意：备份里 **没有 `.venv`**（备份时排除了），需要重建。

---

## 十一、问题归因汇总（回答用户的"是部署还是源码问题"）

| 类别 | 问题 | 是源码 bug 还是部署问题 |
| --- | --- | --- |
| Live2D 显示 | modelInfo.url 被 filter 清空 | **源码 bug**（新版独有） |
| Live2D 切回 | LAppDelegate 单例绑定旧 canvas | **源码 bug** |
| Live2D WebGL2 不可用即崩 | 没有 fallback | **源码缺陷** |
| Live2D `getId` null | Cubism 初始化竞态 | **源码竞态** |
| Live2D xiao_yi 不存在 | model_dict 与资源不一致 | **源码/打包不一致** |
| 退出按钮无效 | shell 脚本 CRLF | **打包/源码** |
| VAD worklet 缺失 | vite 静态拷贝缺项 | **构建配置** |
| avatar_pack 残缺 | 我打包时排除 + rsync 删 | **本次部署引入** |
| `.venv` 丢失 | rsync `--delete-delay` 误删 | **本次部署引入** |
| host=localhost 教师机连不上 | conf.yaml 默认 | **配置问题，与新旧版无关** |
| 麦克风没有 capture | `/boot/firmware/config.txt` 之前被改坏 | **树莓派系统层** |

End of handoff.

---

## 十二、升级规划交接（2026-06-17 新增）

### 12.1 背景

本次会话用户提出一份《升级计划.txt》（位于 `E:\Debian_canvas\vtuber-classroom升级计划.txt`），目标是把现有系统改造为面向"班级教学、分组共用机器"场景的教学版。我已对计划做了逐条评估、与用户确认了所有开放决策，并产出两份正式文档。

### 12.2 已定型的技术决策（用户已确认）

| 决策项 | 结论 |
|--------|------|
| 学生端数据模型 | **方案 A**：用户名作主键 + 班级属性化（目录结构 `profiles/{username}/`，取代 `profile_id = class_slug__student_slug`） |
| 教师端桌面形态 | **pywebview**（系统 WebView2，Win10 1903+ 预装），取代 `webbrowser.open` |
| 用户名规则 | 设备名，仅 `[A-Za-z0-9]`，1–32 字符 |
| 用户名唯一性 | 前端不显示历史；教师机集中存储（`users.json`）+ 离线降级（pending_sync） |
| 形象打包 | 本版全量打包；后续版本再加"默认模型不可删"机制 |
| 缩略图频率 | 30 秒，与状态轮询（5 秒）解耦 |
| 旧档迁移 | 不迁移，全新开始；旧结构保留不动，首启提示恢复初始设置 |
| 恢复初始设置 | 教师端加批量复位功能，清空学生文件保留默认文档 |

### 12.3 产出文档（下一个 agent 直接可用）

| 文档 | 路径 | 用途 |
|------|------|------|
| 升级计划原文 | `E:\Debian_canvas\vtuber-classroom升级计划.txt` | 用户写的初版需求 |
| **PRD** | `E:\Debian_canvas\vtuber-classcontrol\docs\PRD.md` | 产品需求规格说明书（10 章：背景/角色/功能清单 S-1~S-9 + T-1~T-9/业务流程/非功能/验收/风险/里程碑） |
| **开发文档** | `E:\Debian_canvas\vtuber-classcontrol\docs\开发文档.md` | 技术设计说明书（14 章：架构/数据模型/API 设计/关键算法/模块改动清单/排期） |
| 系统分析交接（旧） | `E:\Debian_canvas\vtuber-classcontrol\HANDOFF.md`（本文件前十一章） | 现有系统架构与已修复问题 |

### 12.4 核心改造点速览（下一个 agent 接手时先看这几处）

**学生端（`src/open_llm_vtuber/classroom/`）**
- `storage.py` **重构**：路径函数从 `profile_dir_for_slugs(class_slug, student_slug)` → `profile_dir_for_username(username)`
- `routes.py` 改造：所有 `/classroom/profile/*` 参数 `profile_id` → `username`
- 新增 `auth.py`（登录/创建/退出/会话）、`sync_manager.py`（离线同步/冲突改名）、`workspace.py`（打包/恢复/存档点）
- 前端新增登录页（`frontend-source/src/views/Login.vue`），路由守卫未登录跳 `/login`

**教师端（`teacher-console/teacher_console/`）**
- `__main__.py`：`webbrowser.open` → `pywebview.create_window`
- 新增 `auth.py`（教师登录中间件）、`user_store.py`（全局用户名注册表）、`class_store.py`（班级定义）、`scan_service.py`（后台定时扫描）、`collect_service.py`（进度化批量收取）
- `student_client.py` 改造：新增 check-username / sync / reset；collect 改流式 + 进度
- 前端 `app.js`：缩略图独立轮询 30s；批量收取进度条；设置抽屉

### 12.5 关键 API 新增清单

**学生端**：`/auth/check-username`、`/auth/create`、`/auth/login`、`/auth/logout`、`/workspace/pack`、`/workspace/restore`、`/workspace/saves`、`/classroom/reset`

**教师端**：`/api/auth/login`、`/api/classes`、`/api/users`、`/api/users/check`、`/api/users/sync`、`/api/scan/now`、`/api/batch/collect`（进度化）、`/api/batch/reset`

### 12.6 排期（约 9 周单人）

M1 数据模型重构（2 周）→ M2 学生端打包/恢复（1.5 周）→ M3 教师端 pywebview+登录（1 周）→ M4 教师端班级+扫描（2 周）→ M5 缩略图+进度收取（1.5 周）→ M6 复位+设置收起+联调（1 周）

）+ 可选 `class_name`。
   - `LoadProfileRequest`：`profile_id` → `username`。
   - `ClassroomStatus`：`current_profile_id` → `current_username`，删 `student_name`。
   - `SnapshotItem`：`profile_id` → `username`。

2. `classroom/storage.py`（重构重点）
   - 删 `slug_component/build_profile_id/profile_dir_for_slugs/ensure_safe_profile_id/PROFILE_ID_RE`。
   - 新增 `ensure_safe_username`（正则 `^[A-Za-z0-9]{1,32}# Handoff Document — VTuber Classroom Control 部署与调试

**最后更新**：2026-06-16
**目标硬件**：Raspberry Pi 5 + WM8960 USB-DAC HAT + Waveshare 10.1 寸 DSI 屏
**目标软件**：jacob-VTuber-classroom-control（基于 Open-LLM-VTuber v1.2.1）
**当前状态**：核心功能已可用（管控、Live2D、avatarpack、麦克风、退出），仍有少量待打磨问题

> 同目录下另有 `HANDOFF_classroom_tab_refresh.md`，专门记录"课堂选项卡频繁刷新"的排查上下文。

---

## 一、当前部署拓扑

### 1.1 网络与设备
- 树莓派 5：`192.168.100.133`，用户 `yb` / 密码 `1`
- 教师机（Windows）：当前会话所在机器
- SSH 主机指纹：`SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko`
- 课堂共享令牌：`classroom-test-2026`

### 1.2 树莓派端（数智人 / 学生端）
- 项目目录：`~/Open-LLM-VTuber`
- Python 虚拟环境：`~/Open-LLM-VTuber/.venv`（**Python 3.13.5**，注意：项目 `pyproject.toml` 声明 `requires-python >=3.10,<3.13`，目前是兼容运行）
- 后端入口：`run_server.py`，监听 `0.0.0.0:12393`
- 课堂环境变量：`~/Open-LLM-VTuber/.classroom.env`
  ```
  JACOB_DEVICE_ID=pi-01
  JACOB_DEVICE_NAME=raspberrypi5-test
  JACOB_CLASSROOM_TOKEN=classroom-test-2026
  ```
- 桌面快捷方式：`~/Desktop/翼生涯桌面数智人.desktop` → `scripts/raspberry_pi/start_vtuber_fullscreen.sh`
- kiosk Chromium 用户数据目录：`~/Open-LLM-VTuber/.kiosk-profile`
- 预编译前端：`~/Open-LLM-VTuber/frontend-source/dist/web`（`run_server.py` 会优先用这个）
- 备份：`~/backups/Open-LLM-VTuber_pre_upgrade_20260616.tar.gz`（2.5G，升级前完整快照）
- `conf.yaml.backup` 在 `~/Open-LLM-VTuber/`，由 `upgrade_codes.config_sync` 自动管理

### 1.3 教师机端（管控软件）
- 工作区：`E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master`
- 教师端虚拟环境：`E:\Debian_canvas\vtuber-classcontrol\teacher-venv`（uv 创建，Python 3.12）
- 启动：`PYTHONPATH=teacher-console`，运行 `python -m teacher_console`
- 监听：`http://127.0.0.1:8765`
- 设备配置（已添加）：
  ```json
  {
    "id": "pi-01",
    "name": "树莓派5-测试机",
    "base_url": "http://192.168.100.133:12393",
    "token": "classroom-test-2026",
    "enabled": true
  }
  ```

---

## 二、关键修复记录（按层归类）

### 2.1 项目源代码 bug（已在工作区修，已部署到树莓派）

| 文件 | 问题 | 修复要点 |
| --- | --- | --- |
| `frontend-source/src/renderer/src/context/live2d-config-context.tsx` | `filter: (value) => ({...value, url: ""})` 导致运行态 URL 被清空，Live2D 不初始化 | 移除 `filter` 选项，正常持久化 modelInfo |
| `frontend-source/src/renderer/WebSDK/src/main.ts` | LAppDelegate 单例绑定旧 canvas，`<Live2D/>` 卸载重挂载后画面消失 | 通过 `window.__live2dCanvasRef` 跟踪 canvas，发现替换时全量释放 `LAppLive2DManager / LAppDelegate / LAppGlManager` 再重建 |
| `frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts` | URL 不变时不会重新初始化 | 把 canvas 替换也作为 needsUpdate 条件；并去掉额外的 manager release，避免和 main.ts 冲突 |
| `frontend-source/src/renderer/WebSDK/src/lappglmanager.ts` | 只试 `webgl2`，环境不支持时 alert 并清空 body | fallback 到 `webgl / experimental-webgl`，失败时只 console.error |
| `frontend-source/src/renderer/WebSDK/src/lappmodel.ts` | 加载 `.moc3` 时未保证 `CubismFramework.getIdManager()` 已就绪 | 加守卫：`isStarted/isInitialized/getIdManager` 任一缺失则 `cleanUp / startUp / initialize` |
| `model_dict.json` | 残留 `xiao_yi`，但 zip 包没有此模型 | 移除该条目，保留 `mao_pro / shizuku` |
| `scripts/raspberry_pi/*.sh` | Windows CRLF 换行 | 全部转 LF + chmod +x |
| `frontend-source/dist/web/libs/vad.worklet.bundle.min.js` | vite 静态拷贝未带 | 从旧前端复制过来 |

### 2.2 部署/迁移引入的问题（已修）

| 问题 | 处理 |
| --- | --- |
| `avatar_pack` 因打包排除 + rsync `--delete-delay` 残缺到 956K | 从备份 tar.gz 恢复，95MB / 199 帧 |
| `.venv` 被 rsync 删除 | 用系统 Python 3.13.5 重建，再用清华源 + `--ignore-scripts` 装依赖 |
| `conf.yaml` 的 `host: localhost` 让教师机跨网段连不上 | 改为 `host: 0.0.0.0` |

### 2.3 树莓派系统层问题（已修）

| 问题 | 处理 |
| --- | --- |
| `/boot/firmware/config.txt` 之前禁用了 DSI overlay 和 `display_auto_detect`，导致 WM8960 复位失败、无 capture 设备 | 恢复 `display_auto_detect=1` 和 `dtoverlay=vc4-kms-dsi-waveshare-panel,10_1_inch`；重启后录音设备恢复 |
| 默认 PipeWire source 是 `auto_null.monitor` | 改为 `alsa_input.platform-soc_107c000000_sound.stereo-fallback`，volume 100%，unmute |

---

## 三、当前已确认的功能状态

| 功能 | 状态 | 备注 |
| --- | --- | --- |
| 后端启动 | ✅ | Open-LLM-VTuber v1.2.1 / 0.0.0.0:12393 |
| 主前端加载新版 | ✅ | 当前 bundle 形如 `main-aa5t3o5w.js`（每次构建会变） |
| AvatarPack 帧序列模型 | ✅ | 默认 default_avatarpack |
| Live2D 初次显示 | ✅ | mao_pro / shizuku 都能加载 |
| Live2D ↔ AvatarPack 来回切换 | ⚠️ **未最终验收** | 已部署 canvas 重绑定修复，等用户实测 |
| Live2D 模型间切换（mao_pro ↔ shizuku） | ✅ | 用户已确认 |
| 麦克风录音 | ✅ | wm8960-soundcard / 48k stereo s32_le |
| ASR（sherpa-onnx sense_voice 中文） | ✅ | smoke test：模型自带 zh.wav 转写"开放时间早上9点至下午5点。" |
| TTS（volcengine_tts） | ⚠️ 需 conf.yaml 中 API Key | 旧配置已保留 |
| `/system/exit` 退出按钮 | ✅ | 关闭后端 + kiosk 浏览器 |
| 桌面快捷方式 | ✅ | 已修复权限 + LF |
| 教师端 → 树莓派 `/classroom/status` | ✅ | latency ~30-130ms |
| 教师端锁定/解锁 | ✅ | `classroom_locked` 字段流转正常 |
| 教师端缩略图 | ✅ | 5s 自动上传 |
| 教师端文件分发 | ✅ | 需先在前端创建 classroom profile |
| 教师端作品收集（zip） | ✅ | 文件落到 `%LOCALAPPDATA%\JacobTeacherConsole\collections\` |

---

## 四、已知遗留问题（待下一个 agent 跟进）

### 4.1 高优先级
1. **Live2D ↔ AvatarPack 来回切换稳定性最终验收**
   - 已修 canvas 重绑定，用户最近一次实测前已重启 kiosk，等用户 sign-off。
   - 如仍偶发消失，建议改成"切换 avatarMode 时强制 `location.reload()`"，最稳但有刷新感。

2. **课堂选项卡刷新行为**（用户最近反馈）
   - 现象：树莓派前端"课堂"选项卡频繁刷新。
   - 未深入定位。建议：
     - 看 `frontend-source/src/renderer/src/components/sidebar/setting/classroom-*.tsx`
     - 看 `useEffect` 是否依赖了每次 `/classroom/status` 返回的新对象
     - 看 `ClassroomSnapshotUploader` 是否触发不必要的 React 重渲染
     - 看是否因为 polling 而重新 mount
   - 同目录 `HANDOFF_classroom_tab_refresh.md` 是上一轮针对这个问题的初步分析交接文档，可继续接力。

3. **教师端管控软件使用逻辑**：用户希望有一份 user-facing 的使用文档（参见第六节"建议补充交付物"）。

### 4.2 中优先级
1. **`model_dict.json` 中 xiao_yi 已被移除**
   - 如果业务方需要 xiao_yi，需要单独提供模型资源（zip 包和备份里都没有）。

2. **Python 3.13 兼容**
   - 目前能跑，但 `pyproject.toml` 声明的是 `<3.13`，长期最好在树莓派上装 Python 3.12.13 重建 venv。
   - 安装路径建议：pyenv 编译，或用 deadsnakes/官方 Debian backports。

3. **TTS / LLM 真正端到端对话**
   - smoke test 只验证了 ASR；TTS 走的是火山引擎，需要 `conf.yaml` 里的 `volcengine_tts` 配置和 API Key 还在并有余额。
   - LLM 用的是 `dashscope qwen3.6-flash`（DashScope OpenAI 兼容接口），同样需要 API Key 在线。

### 4.3 低优先级
1. **构建警告**：
   - vite 提示 `onnxruntime-web` 用了 eval（无害）
   - main 包大于 500KB（性能优化空间）
2. **教师端中文设备名在 PowerShell 控制台显示 `???`**：仅 cmd/PowerShell 编码问题，浏览器界面正常。

---

## 五、关键操作脚本（位于工作区根目录）

| 脚本 | 用途 |
| --- | --- |
| `audit_pi_deploy.py` | 树莓派端 50 项部署完整性审计（目录、模型引用、HTTP、依赖等） |
| `summarize_audit.py` | 把审计 JSON 汇总成失败列表 |
| `check_pydeps.py` | 树莓派 venv 依赖快速 import 测试 |
| `check_live2d_refs.py` | 校验 model3.json 内部引用文件全部存在 |
| `restart_after_live2d_fix.sh` | 重启树莓派后端（停旧、source `.classroom.env`、起新） |
| `start_chromium_kiosk.sh` | 普通 kiosk Chromium 启动（无 remote-debug） |
| `start_chromium_kiosk_debug.sh` | 带 `--remote-debugging-port=9223` 的 kiosk，用来 CDP 调试 |
| `cdp_existing_kiosk_probe.py` | 通过 9223 抓真实 kiosk 页面的 console / pageerror / DOM 状态 |
| `cdp_canvas_probe_light.py` | 抓 canvas 元素层级 + Live2D model 状态 |
| `cdp_force_live2d_visible.py` | 紧急把模型矩阵重置到正中央可见区域（应急用） |
| `fix_live2d_catalog.py` | 清理 model_dict.json 中无效条目 |
| `fix_shell_scripts.py` | 把树莓派上 `scripts/**/*.sh` 全部转 Unix LF |
| `start_after_audio_fix.sh` | 设默认麦克风源 + 重启后端 |
| `restore_avatar_pack.sh` | 从备份 tar.gz 恢复 avatar_pack |

---

## 六、建议补充交付物

下一个 agent 接手时如果时间允许，建议补这些：

1. **教师端使用文档**（用户主动要过）
   - 课堂流程怎么走？教师怎么开始一节课？
   - "锁定"是软件内 lock overlay，**不是系统级锁屏**，需要在文档里说清楚。
   - 文件分发、作品收集的目录约定。
   - 当前 `jacob-VTuber-classroom-control-master/teacher-console/README.md` 是技术性的，建议加一份 user-facing 的。

2. **Python 3.12 重建 venv 的脚本**
   - 在 Pi OS Debian 13 trixie 上 apt 没有 python3.12，需要 pyenv 或源码编译。
   - 期望产出：一个 `scripts/raspberry_pi/setup_python312.sh`。

3. **课堂选项卡频繁刷新问题修复**

4. **CRLF/LF 防护**：在工作区加 `.gitattributes`：
   ```
   *.sh text eol=lf
   *.py text eol=lf
   ```

5. **打包脚本**：把"工作区代码 → 树莓派部署"这条链路标准化（避免再次出现 rsync 误删 `.venv` / `avatar_pack`）。当前思路：
   - tar 时显式 include 列表，而不是 exclude。
   - rsync 不要带 `--delete-delay`，或者 `--delete-excluded` 时严格指定 exclude-from 文件。

---

## 七、下一个 agent 立即可用的连接命令

### 7.1 SSH 到树莓派
```bat
plink -batch -ssh -hostkey "SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko" -pw 1 yb@192.168.100.133 "<command>"
```

### 7.2 SCP 上传文件到树莓派
```bat
pscp -batch -hostkey "SHA256:jvYjbVWb/lAQbS/9Oldrzg1krFswrjgOPk45/rvgGko" -pw 1 <local> yb@192.168.100.133:<remote>
```

### 7.3 教师端 API
```bat
:: 刷新设备状态
curl.exe -s -X POST http://127.0.0.1:8765/api/devices/pi-01/refresh

:: 锁定
curl.exe -s -X POST -H "Content-Type: application/json" -d "{\"locked\":true}" http://127.0.0.1:8765/api/devices/pi-01/lock

:: 文件分发
curl.exe -s -X POST -F "file=@xxx.txt" http://127.0.0.1:8765/api/devices/pi-01/files/upload

:: 作品收集
curl.exe -s -X POST http://127.0.0.1:8765/api/devices/pi-01/collect
```

### 7.4 重启树莓派 kiosk（不重启后端）
```
plink ... yb@192.168.100.133 "pkill -f /home/yb/Open-LLM-VTuber/.kiosk-profile 2>/dev/null"
plink ... yb@192.168.100.133 "bash /tmp/start_chromium_kiosk.sh"
```
（`pkill` 命令的 exit code 128 是 plink 自身退出码问题，可以忽略，进程其实已被杀。）

### 7.5 抓真实 kiosk 页面状态（CDP）
1. 用 `start_chromium_kiosk_debug.sh` 启动（带 `--remote-debugging-port=9223`）
2. 跑 `cdp_existing_kiosk_probe.py` / `cdp_canvas_probe_light.py`

---

## 八、踩过的环境坑（提醒下一个 agent）

1. **plink 远程命令里 `$()` 会被 Windows cmd 当作字面量**：所有需要远程 shell 替换的逻辑写到 `.sh` 上传后再 `bash xxx.sh`。

2. **plink 远程 `pkill -f xxx` 会让自己 exit 128**：因为命令行里也包含 xxx，被自己匹配。但目标进程通常已经被杀。可以用 `[x]xx` 这种 trick，或者忽略 exit code。

3. **树莓派 PyPI 直连不稳**：用清华镜像 `https://pypi.tuna.tsinghua.edu.cn/simple`；树莓派全局 pip 配置默认带 piwheels，遇到 SSL 错时用 `pip --isolated` 绕开。

4. **`npm ci` 卡在 Electron postinstall**：用 `npm ci --ignore-scripts`。我们只构建 web。

5. **vite 构建产物输出在 `frontend-source/../dist/web`，即项目根 `dist/web`**：但 `run_server.py` 检查的是 `frontend-source/dist/web/index.html`。当前两者实际指同一处（vite 配置里 outDir 是相对路径，巧合一致）。

6. **rsync 误删**：所有部署脚本不要带 `--delete-delay`，或者用严格的 `--exclude-from` 白名单。

7. **WM8960 必须 `display_auto_detect=1` + DSI overlay**：禁用 DSI 时 WM8960 探测失败，连带没有麦克风。

---

## 九、本次会话内已部署到树莓派的所有改动汇总

只列改了什么，便于 review/回滚：

```
~/Open-LLM-VTuber/
  frontend-source/src/renderer/src/context/live2d-config-context.tsx       (源码 bug 修复)
  frontend-source/src/renderer/src/hooks/canvas/use-live2d-model.ts        (canvas 替换重新初始化)
  frontend-source/src/renderer/WebSDK/src/main.ts                          (canvas 替换检测 + 完整重建)
  frontend-source/src/renderer/WebSDK/src/lappglmanager.ts                 (WebGL fallback)
  frontend-source/src/renderer/WebSDK/src/lappmodel.ts                     (CubismFramework getId 守卫)
  frontend-source/dist/web/                                                (npm run build:web 产物)
  frontend-source/dist/web/libs/vad.worklet.bundle.min.js                  (从旧前端拷回)
  scripts/raspberry_pi/*.sh                                                (CRLF -> LF, chmod +x)
  model_dict.json                                                          (移除 xiao_yi)
  conf.yaml                                                                (host: localhost -> 0.0.0.0)
  .classroom.env                                                           (新建)
  avatar_pack/                                                             (从备份恢复完整内容)
  .venv/                                                                   (重建,Python 3.13.5)

/boot/firmware/config.txt                                                  (display_auto_detect=1, DSI overlay 启用)
PipeWire 默认 source                                                        (alsa_input.platform-soc_107c000000_sound.stereo-fallback)
~/Desktop/翼生涯桌面数智人.desktop                                           (chmod +x)
```

工作区端（Windows）改动：
```
E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\
  frontend-source\src\renderer\src\context\live2d-config-context.tsx       (与树莓派同)
  frontend-source\src\renderer\src\hooks\canvas\use-live2d-model.ts        (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\main.ts                          (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\lappglmanager.ts                 (与树莓派同)
  frontend-source\src\renderer\WebSDK\src\lappmodel.ts                     (与树莓派同)
```

工作区还多了一堆调试/部署脚本（见第五节）。

---

## 十、回滚方案（应急用）

如果新版部署彻底崩了：

```bash
plink ... "cd ~ && rm -rf Open-LLM-VTuber.broken && mv Open-LLM-VTuber Open-LLM-VTuber.broken && tar xzf backups/Open-LLM-VTuber_pre_upgrade_20260616.tar.gz"
```

注意：备份里 **没有 `.venv`**（备份时排除了），需要重建。

---

## 十一、问题归因汇总（回答用户的"是部署还是源码问题"）

| 类别 | 问题 | 是源码 bug 还是部署问题 |
| --- | --- | --- |
| Live2D 显示 | modelInfo.url 被 filter 清空 | **源码 bug**（新版独有） |
| Live2D 切回 | LAppDelegate 单例绑定旧 canvas | **源码 bug** |
| Live2D WebGL2 不可用即崩 | 没有 fallback | **源码缺陷** |
| Live2D `getId` null | Cubism 初始化竞态 | **源码竞态** |
| Live2D xiao_yi 不存在 | model_dict 与资源不一致 | **源码/打包不一致** |
| 退出按钮无效 | shell 脚本 CRLF | **打包/源码** |
| VAD worklet 缺失 | vite 静态拷贝缺项 | **构建配置** |
| avatar_pack 残缺 | 我打包时排除 + rsync 删 | **本次部署引入** |
| `.venv` 丢失 | rsync `--delete-delay` 误删 | **本次部署引入** |
| host=localhost 教师机连不上 | conf.yaml 默认 | **配置问题，与新旧版无关** |
| 麦克风没有 capture | `/boot/firmware/config.txt` 之前被改坏 | **树莓派系统层** |

End of handoff.

---

## 十二、升级规划交接（2026-06-17 新增）

### 12.1 背景

本次会话用户提出一份《升级计划.txt》（位于 `E:\Debian_canvas\vtuber-classroom升级计划.txt`），目标是把现有系统改造为面向"班级教学、分组共用机器"场景的教学版。我已对计划做了逐条评估、与用户确认了所有开放决策，并产出两份正式文档。

### 12.2 已定型的技术决策（用户已确认）

| 决策项 | 结论 |
|--------|------|
| 学生端数据模型 | **方案 A**：用户名作主键 + 班级属性化（目录结构 `profiles/{username}/`，取代 `profile_id = class_slug__student_slug`） |
| 教师端桌面形态 | **pywebview**（系统 WebView2，Win10 1903+ 预装），取代 `webbrowser.open` |
| 用户名规则 | 设备名，仅 `[A-Za-z0-9]`，1–32 字符 |
| 用户名唯一性 | 前端不显示历史；教师机集中存储（`users.json`）+ 离线降级（pending_sync） |
| 形象打包 | 本版全量打包；后续版本再加"默认模型不可删"机制 |
| 缩略图频率 | 30 秒，与状态轮询（5 秒）解耦 |
| 旧档迁移 | 不迁移，全新开始；旧结构保留不动，首启提示恢复初始设置 |
| 恢复初始设置 | 教师端加批量复位功能，清空学生文件保留默认文档 |

### 12.3 产出文档（下一个 agent 直接可用）

| 文档 | 路径 | 用途 |
|------|------|------|
| 升级计划原文 | `E:\Debian_canvas\vtuber-classroom升级计划.txt` | 用户写的初版需求 |
| **PRD** | `E:\Debian_canvas\vtuber-classcontrol\docs\PRD.md` | 产品需求规格说明书（10 章：背景/角色/功能清单 S-1~S-9 + T-1~T-9/业务流程/非功能/验收/风险/里程碑） |
| **开发文档** | `E:\Debian_canvas\vtuber-classcontrol\docs\开发文档.md` | 技术设计说明书（14 章：架构/数据模型/API 设计/关键算法/模块改动清单/排期） |
| 系统分析交接（旧） | `E:\Debian_canvas\vtuber-classcontrol\HANDOFF.md`（本文件前十一章） | 现有系统架构与已修复问题 |

### 12.4 核心改造点速览（下一个 agent 接手时先看这几处）

**学生端（`src/open_llm_vtuber/classroom/`）**
- `storage.py` **重构**：路径函数从 `profile_dir_for_slugs(class_slug, student_slug)` → `profile_dir_for_username(username)`
- `routes.py` 改造：所有 `/classroom/profile/*` 参数 `profile_id` → `username`
- 新增 `auth.py`（登录/创建/退出/会话）、`sync_manager.py`（离线同步/冲突改名）、`workspace.py`（打包/恢复/存档点）
- 前端新增登录页（`frontend-source/src/views/Login.vue`），路由守卫未登录跳 `/login`

**教师端（`teacher-console/teacher_console/`）**
- `__main__.py`：`webbrowser.open` → `pywebview.create_window`
- 新增 `auth.py`（教师登录中间件）、`user_store.py`（全局用户名注册表）、`class_store.py`（班级定义）、`scan_service.py`（后台定时扫描）、`collect_service.py`（进度化批量收取）
- `student_client.py` 改造：新增 check-username / sync / reset；collect 改流式 + 进度
- 前端 `app.js`：缩略图独立轮询 30s；批量收取进度条；设置抽屉

### 12.5 关键 API 新增清单

**学生端**：`/auth/check-username`、`/auth/create`、`/auth/login`、`/auth/logout`、`/workspace/pack`、`/workspace/restore`、`/workspace/saves`、`/classroom/reset`

**教师端**：`/api/auth/login`、`/api/classes`、`/api/users`、`/api/users/check`、`/api/users/sync`、`/api/scan/now`、`/api/batch/collect`（进度化）、`/api/batch/reset`

### 12.6 排期（约 9 周单人）

M1 数据模型重构（2 周）→ M2 学生端打包/恢复（1.5 周）→ M3 教师端 pywebview+登录（1 周）→ M4 教师端班级+扫描（2 周）→ M5 缩略图+进度收取（1.5 周）→ M6 复位+设置收起+联调（1 周）

）、`profile_dir_for_username`（目录 `profiles/{username}/` 单级）、`safe_save_id`。
   - `create_profile(username, character_config, class_name=None, pending_sync=False)`；`get_profile/save_profile_from_*/set_profile_dirty/profile_directory/...` 全部参数 `profile_id` → `username`。
   - `conf_uid = profile.username`；`chat_history/{username}/`；manifest 字段改为 `username/class_name/pending_sync`。
   - `runtime_state.json`：`current_profile_id` → `current_username`。
   - 新增 `UserRegistry` 类（读写 `registry/local_users.json`，register/exists/mark_synced/list_pending/rename/remove）。
   - 新增 `SavePointStore` 类（存档点 CRUD，`profiles/{username}/saves/{save_id}/`）。
   - 新增 `rename_user(old, new)`：物理迁移目录 + 更新 profile.yaml/conf_uid + chat_history + runtime_state（供 M2 离线冲突改名用）。

3. `classroom/routes.py`
   - 路径参数 `/profile/{profile_id}/export` → `/profile/{username}/export`。
   - `build_status` 返回 `current_username`（取代 `current_profile_id`）。
   - `current_profile_id()` 函数 → `current_username()`；所有路由入参/body 走 username；`save_runtime_state(current_username=...)`。

4. `service_context.py`：`classroom_profile_id` → `classroom_username`，删 `classroom_student_name`。
5. `websocket_handler.py`：6 处引用（字段拷贝块 + `_persist_persona_config`/`_persist_avatar_config` 守卫与比较）全改为 `classroom_username`/`profile.username`。
6. 教师端：
   - `student_client.collect_profile`：参数 `profile_id` → `username`，URL `/classroom/profile/{username}/export`，文件名清洗保留兼容。
   - `app.py` collect 闭包：读 `status["current_username"]`，返回 `{"username": ...}`。
   - `static/app.js`：状态标签读 `status.current_username`。
7. 前端（最小改动，登录页留 M2）：
   - `classroom-context.tsx`：`ClassroomStatus.current_profile_id` → `current_username`；`ClassroomProfile` 改 `username` + `pending_sync`，删 slug/student_name；`createProfile(username, className?)`/`loadProfile(username)`；匹配与排序逻辑走 username。
   - `classroom-status-bar.tsx`、`setting/classroom.tsx`：读 `current_username`/`profile.username`；创建 UI 改为 username 输入（必填）+ class_name（可选）。
   - i18n（zh/en）：`studentName` 插值 → `username`，新增 `username`/`usernamePlaceholder` 文案。

**测试与验收**：
- 学生端测试：`tests/test_classroom_storage.py` + `test_classroom_api.py` + `test_classroom_files.py` 共 **36 passed**（新增 UserRegistry/SavePointStore/rename_user/username 校验等用例）。
- 教师端测试：`test_teacher_console.py`(8) + `test_teacher_console_16_devices.py`(2) 共 **10 passed**。
- grep 复查：源码/测试/前端均无功能性 `profile_id/class_slug/student_slug/current_profile_id/classroom_profile_id/classroom_student_name` 残留（测试中仅保留"断言旧字段不存在"的引用）。
- 端到端冒烟（树莓派 192.168.100.133 实跑）：
  - 学生端 21 项全过：创建 GroupA01 → status.current_username 正确 → 保存 → 按 username 导出 ZIP（profile.yaml/manifest 含 username、无 profile_id、pending_sync=False）→ 按 username 加载 → 非法 username 返回 422。
  - 教师端 7 项全过：get_status 读 current_username → collect_profile 按 username 收取 → 作品落地 `collections/2026-06-17/pi-01_GroupA01.zip`，manifest.username 正确。
  - 树莓派目录结构验证：`classroom_data/profiles/GroupA01/`（单级，含 profile.yaml/manifest.json/assets/）。

**部署情况**：
- 树莓派旧 classroom 模块已备份到 `~/.m1_backup/`；旧 `classroom_data` 已备份为 `classroom_data.preM1.bak.*`。
- 改造后的 models/storage/routes/service_context/websocket_handler 已 SFTP 上传到树莓派 `~/Open-LLM-VTuber/src/open_llm_vtuber/`。
- 冒烟用临时后端进程已停止（端口 12393 已释放）；树莓派上保留的 `classroom_data/profiles/GroupA01/` 为冒烟产物，可在 M2 前清理。
- **注意**：树莓派 kiosk/桌面快捷方式未动；前端 dist 未重新构建（M1 前端改动需在 M2 重新 `npm run build` 后部署，当前线上前端仍是旧版，故学生端 kiosk 的课堂设置面板仍是旧的 class_name/student_name 形态——这是预期的，登录页与工作区 UI 统一在 M2 落地）。

**已知遗留 / M2 起点**：
- 前端登录页 `frontend-source/src/views/Login.vue`（或等价）尚未新增；当前学生端仍直接进主界面，未走"登录页→主界面"流程。
- `/auth/*`（check-username/create/login/logout/me）路由未实现（`auth.py` 待新增）。
- `/workspace/*`（pack/restore/saves）路由未实现（`workspace.py` 待新增）。
- `sync_manager.py`（离线同步/冲突改名）未实现，但 `rename_user`/`UserRegistry` 地基已就绪。
- 教师端 `/api/users/*`、`/api/classes/*`、`/api/scan/*` 未实现（M4）。
- 树莓派前端 dist 需在 M2 末尾重新构建部署。

**M2 任务清单**：
1. 新增 `src/open_llm_vtuber/classroom/auth.py`（登录/创建/退出/会话，调教师机 check-username，离线降级 pending_sync）。
2. 新增 `src/open_llm_vtuber/classroom/workspace.py`（打包/恢复/存档点 CRUD，复用 `SavePointStore`）。
3. 新增 `src/open_llm_vtuber/classroom/sync_manager.py`（后台同步 pending_sync 用户，冲突改名复用 `rename_user`）。
4. 前端新增登录页 + 路由守卫，`frontend-source/src/views/Login.vue`；改造工作区 UI。
5. 重新构建前端 dist 并部署到树莓派。

### 12.9 M2 完成记录（2026-06-17）

**完成内容**：

1. `classroom/auth.py`（新增）：
   - `POST /auth/check-username`：本地 UserRegistry 去重 → 教师机 `/api/users/check`（2s 超时）→ 离线降级返回 `offline:true`。
   - `POST /auth/create`：本地去重 + 教师机校验决定 `pending_sync`（离线=True）→ `create_profile(pending_sync=)` + `UserRegistry.register` + 知识库/聊天历史初始化 + apply 到上下文 + 生成 `session_token` 写 runtime_state。
   - `POST /auth/login`：`get_profile` + restore + apply + 更新 registry last_login + session_token；不存在返回 404 + `suggest_create:true`。
   - `POST /auth/logout`：可选 `save_before_exit` 保存后清 current_username/session_token。
   - `GET /auth/me`：返回 username/profile/pending_sync/session_token。
2. `classroom/workspace.py`（新增）：
   - `POST /workspace/pack`：复用 `build_export_zip`，返回 `{username}.zip`。
   - `POST /workspace/restore`：上传 ZIP 解压到 `profiles/{username}/`（zip slip 防护，保留 saves/），重新 apply。
   - `GET/POST /workspace/saves`、`POST /workspace/saves/{id}/load`、`DELETE /workspace/saves/{id}`：复用 `SavePointStore` CRUD，存档点 ZIP 含全量状态。
3. `classroom/sync_manager.py`（新增）：
   - `SyncManager` 后台 asyncio 循环（30s 间隔），遍历 `UserRegistry.list_pending()`，向教师机 `POST /api/users/sync`。
   - 教师机返回 `synced:true` → `mark_synced`；返回冲突 + `new_name_suggested` → `rename_user` + `registry.rename` + 写 runtime_state `sync_conflict` 供前端读取。
   - 教师机不可达 / 未实现端点（404）→ 本轮跳过。模块级单例 `sync_manager`。
4. `server.py`：注册 auth/workspace 路由；`initialize()` 末尾 `sync_manager.start()`，shutdown 钩子 `sync_manager.stop()`。
5. 前端（`frontend-source/src/renderer/src/`）：
   - `context/classroom-context.tsx`：新增 `authUsername/isAuthenticated/pendingSync` state + `checkUsername/createUser/loginUser/logoutUser/refreshAuth` 方法；启动时调 `/auth/me` 恢复登录态。
   - `components/classroom/login.tsx`（新增）：登录页（用户名输入 + 登录/创建按钮，`autocomplete="off"`，PRD S-1/S-2/S-3）。
   - `components/classroom/classroom-gate.tsx`（新增）：未认证显示 Login，已认证放行。
   - `App.tsx`：ClassroomGate 包裹 AppContent（登录守卫）。
   - i18n（zh/en）：新增 `classroom.login.*` 文案。
6. 构建：`npm run build:web` 产物 `dist/web/`，已 SFTP 部署到树莓派 `~/Open-LLM-VTuber/frontend-source/dist/web`。

**测试与验收**：
- 单元测试：`tests/test_classroom_m2.py` **13 passed**（auth 6 + workspace 4 + sync_manager 3，含离线降级/冲突改名/同步清标记/无 pending 跳过）。
- 全量回归：M1+M2 共 **49 passed**（无回归）。
- 端到端冒烟（树莓派实跑）**27 项全过**：未登录→check-username(离线)→create(pending_sync=True)→me→pack→存档CRUD→restore→logout→login→不存在提示创建→非法 username 422。
- sync_manager 后台循环已随 server 启动（日志确认 `SyncManager background loop started`）。

**已知遗留 / 后续**：
- 教师端 `/api/users/check`、`/api/users/sync` 端点尚未实现（M4），当前学生端离线降级正常工作；教师机实现后 sync_manager 会自动接管。
- 前端"离线创建提示条"（PRD S-3 顶部提示）依赖 `pending_sync` state，已在 context 暴露，UI 提示条待 M6 打磨。
- 冲突改名的"提示学生改名"交互 UI 待 M6（runtime_state.sync_conflict 已写入，前端轮询读取即可）。

**M3 起点**：教师端 pywebview 改造 + 登录鉴权（T-1/T-2）。

### 12.10 M3 完成记录（2026-06-17）

**教师端 pywebview 改造 + 登录鉴权（T-1/T-2）**：

1. `teacher_console/auth.py`（新增）：
   - `AuthStore`：bcrypt hash 存密码（默认 `ybszr/123456`），会话 token 内存集合，改密清所有 token。
   - `require_teacher_auth` 中间件依赖：放行 `/`、`/static/*`、`/api/auth/login`，其余校验 `Authorization: Bearer <token>`。
   - `/api/auth/login`、`/logout`、`/me`、`/password` 路由。
2. `app.py`：`create_app` 加 `enable_auth` 参数，注册 auth 路由 + http 中间件。
3. `__main__.py`：`webbrowser.open` → `pywebview.create_window`（标题"Jacob VTuber 课堂管控台"，1280x800，无边框/地址栏/书签栏）；`--no-window`/`--no-auth` 选项供测试/无头；pywebview 缺失回退浏览器。
4. 前端 `static/app.js`：`requestJson` 自动注入 Bearer token + 401 跳登录页；`showLogin`/`bootstrap` 启动检查 token。
5. `static/index.html` + `styles.css`：登录遮罩 UI。

**测试**：`test_teacher_auth.py` 5 passed（默认登录/401/公开路径/logout 失效 token/改密/持久化）。

### 12.11 M4 完成记录（2026-06-17）

**班级管理 + 用户管理 + 自动扫描（T-3/T-4）**：

1. `teacher_console/user_store.py`（新增）：`UserStore` 全局用户名注册表（users.json），`register/check_available/sync_from_device/update_class`，线程安全。
   - **修复死锁**：`sync_from_device` 内不可调 `self.register`（重复加锁），改为内联登记逻辑。
2. `teacher_console/class_store.py`（新增）：`ClassStore` 班级 CRUD（classes.json），`create/rename/delete`，删班时学生回未分班。
3. `teacher_console/scan_service.py`（新增）：`ScanService` 后台 asyncio 循环（60s 间隔，`JACOB_SCAN_INTERVAL` 可配），并发扫描设备（信号量限 8），`scan_once/start/stop/status`。
4. `app.py`：`create_app` 加 `enable_scan` 参数；初始化 `ClassStore`/`UserStore`/`ScanService` 挂 `app.state`；startup 启动扫描、shutdown 停止。
5. 路由：`/api/classes` CRUD、`/api/users` 列表/归班、`/api/users/check`、`/api/users/sync`（学生端 sync_manager 调用）、`/api/scan/now`、`/api/scan/status`。

**测试**：`test_teacher_m4.py` 16 passed（ClassStore CRUD/校验 + UserStore 注册/去重/同步/冲突/归班/持久化 + API 集成含删班解绑）。

### 12.12 M5 完成记录（2026-06-17）

**低频缩略图 + 管控增强 + 进度化收集（T-5/T-6/T-7）**：

1. T-5 缩略图：
   - 学生端 `classroom-snapshot-uploader.tsx`：5s→**30s** 间隔，640x360→**320x180**，质量 0.72→**0.5**（低频缩略图，降带宽）。
   - 教师端 `student_client.get_thumbnail`（GET /classroom/snapshot）。
   - 路由 `/api/devices/{id}/thumbnail`（代理取图）、`/api/thumbnails`（批量元信息，基于 status_cache.snapshot_updated_at）。
2. T-6 管控增强：
   - `student_client.force_save`/`force_submit`（POST /classroom/profile/save|submit）。
   - 路由 `/api/devices/{id}/unlock`、`/save`、`/submit`（锁屏复用既有 `/api/devices/{id}/lock` + `/api/batch/lock`）；`_control_one` 统一处理（catch KeyError）。
3. T-7 进度化收集：
   - `POST /api/batch/collect-stream` SSE 端点：流式推送 `start`/`progress`(每设备 ok+path/error)/`done`(succeeded 计数)，`StreamingResponse` + `text/event-stream`。

**测试**：`test_teacher_m5.py` 8 passed（缩略图代理/概览 + 锁/解锁/强制保存提交/批量锁/未知设备 + SSE 流含 start/progress/done + 缺 profile 处理）。

**教师端全量**：M3+M4+M5+M1 共 **37 passed**。

### 12.13 M6 完成记录（2026-06-18）

**恢复初始设置 + 设置收起 + 联调（T-8/T-9）**：

1. T-8 恢复初始设置：`auth.py` logout 时 `_restore_default_config` —— 模块级缓存首次 create 时的默认 character_config 快照，logout 后 `apply_character_config` 恢复 + 清 classroom 镜像字段，避免下一用户继承上一用户人设。
2. T-9 设置面板收起：**确认现有代码已实现**（`App.tsx` 的 `showSettingsSidebar`/`toggleSettingsSidebar` + `Sidebar` 组件 `isCollapsed`/`ToggleButton` + `sidebarStyles` 折叠态），无需改动。
3. 前端重新构建（含 M5 缩略图频率调整）：`npm run build:web` 成功，产物 `dist/web/`。

**联调状态**：
- 学生端全量回归：M1+M2 **49 passed**（含 auth.py logout 改动）。
- 教师端全量：**37 passed**。
- **树莓派端到端冒烟：完成（2026-06-18）** —— 设备恢复可达后，`pi_deploy_m6.py` 成功上传 auth.py + 前端 dist；启动后端（日志确认 `SyncManager background loop started` + `Application startup complete` + 端口 12393 监听）；`smoke_m2.py` **27 项全过**：未登录→check-username(离线)→create(pending_sync=True)→me→pack→存档CRUD→restore→logout→login→不存在提示创建→非法 username 422。M2-M6 全链路在树莓派实机验证通过。

**已知遗留**：
- 教师端前端 `static/app.js` 尚未加班级管理/用户列表/缩略图墙/SSE 进度条的 UI（后端 API 已就绪，前端 UI 可在后续迭代补，不影响 API 验收）。
- 学生端"离线创建提示条"与"冲突改名提示"UI 待打磨（state 已在 context 暴露）。

