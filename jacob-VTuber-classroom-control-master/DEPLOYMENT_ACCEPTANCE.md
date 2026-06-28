# RK3576 教学数智人部署与验收记录

更新时间：2026-06-28

## 交付状态

- 设备：KICKPI-K7 / RK3576 / Debian 12 / ARM64
- 项目目录：`/home/linaro/jacob-vtuber-classcontrol/jacob-VTuber-classroom-control-master`
- 服务地址：`http://localhost:12393/`
- 桌面入口：`翼生涯桌面数智人`
- 当前状态：服务和正式 kiosk 浏览器均已启动，屏幕停留在登录页，可创建用户名或使用已有用户名登录。

## 本次修复

1. 修复登录或刷新后 Live2D 状态反复覆盖的问题。
2. 修复 `kScale` 在重复应用配置时不断翻倍的问题；刷新后稳定为 `1`。
3. 稳定 localStorage setter 和人物外观 context 回调，避免配置副作用循环。
4. 将后台同步任务放到 Uvicorn 的事件循环中启动，修复退出时 `future belongs to a different loop`。
5. 补齐默认背景图，消除 `/bg/ceiling-window-room-night.jpeg` 的 404。
6. 重新构建并部署 web 前端。
7. 固定 RK3576 板载 `rockchip-es8388` 为默认麦克风和扬声器，并在启动时禁用 HDMI/DP 音频路由，避免 Chromium 恢复到显示器音频。
8. 修复课堂用户首次对话时 `chat_history/<username>` 目录不存在导致回答链路中断的问题。

## 验收结果

| 项目 | 结果 |
|---|---|
| 正式桌面启动脚本 | 通过，退出码 0 |
| 服务监听 | 通过，`0.0.0.0:12393` |
| 首页与默认背景 | HTTP 200 |
| Live2D | 通过，`mao_pro` 正常加载和渲染，canvas 为 1920×1080 |
| 刷新稳定性 | 通过，多次清理状态和刷新后 `avatarMode=live2d`、`kScale=1` |
| 文字对话 | 通过，输入“你能听见我说话吗”，回复“能听见，我能收到你说的话” |
| LLM 首字延迟 | 约 0.67 秒（本次测试） |
| TTS | 通过，返回两段音频，浏览器报告播放完成 |
| 音频输入链路 | 通过，音频进入 ASR 后触发 LLM 和 TTS；此前中文麦克风样本转写也已通过 |
| 板载音频路由 | 通过，Chromium 输入/输出均连接到 `dailink-multicodecs ES8323 HiFi-0` |
| 课堂用户历史写入 | 通过，`test01` 对话时自动创建历史目录，不再报 `chat_history/... No such file or directory` |
| 优雅退出 | 通过，后台同步任务正常停止，无跨事件循环异常 |
| 麦克风/扬声器硬件 | 已通过 ALSA 录音和播放测试 |

测试截图：

- `ui_after_reload.png`：Live2D 主界面
- `final_delivery.png`：正式 kiosk 启动后的交付登录页

## 使用方式

1. 在小主机桌面双击“翼生涯桌面数智人”。
2. 首次使用选择“创建用户名”；已有用户名直接登录。
3. 登录后点击绿色麦克风按钮进行语音对话，也可在底部输入框输入文字并回车。

服务日志：

```bash
tail -f /home/linaro/jacob-vtuber-classcontrol/jacob-VTuber-classroom-control-master/logs/launcher_server.log
```

重新启动正式界面：

```bash
DISPLAY=:0 XAUTHORITY=/home/linaro/.Xauthority \
  /home/linaro/jacob-vtuber-classcontrol/jacob-VTuber-classroom-control-master/scripts/raspberry_pi/start_vtuber_fullscreen.sh
```

## 非阻塞提示

- 模型目录中 `xiao_yi` 的清单路径不完整，会产生 catalog warning；当前交付使用 `mao_pro`，不受影响。
- ONNX Runtime 会打印 DRM GPU 探测 warning；ASR 明确使用 CPU，属于预期日志。
- API 凭据当前位于设备配置文件和原始交接资料中。正式生产前应轮换凭据，并限制配置文件权限与资料分发范围。
