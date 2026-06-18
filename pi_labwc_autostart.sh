#!/bin/sh
# 屏幕输出配置：
# - 有外接 HDMI 屏：禁用 DSI-2，外接屏作主输出（顶栏显示在外接屏）
# - 无外接屏：启用 DSI-2 但不旋转（VNC 捕获横屏 1280x800；物理触控屏竖屏显示，VNC 时不看物理屏）
if ! wlr-randr 2>/dev/null | grep -q '^HDMI-A-1'; then
  wlr-randr --output DSI-2 --transform normal --mode 1280x800@60.026001 &
else
  # 有外接屏：禁用 DSI-2，外接屏作主输出
  wlr-randr --output DSI-2 --off --output HDMI-A-1 --on --preferred --pos 0,0 &
fi

# 设置默认音频输入为 wm8960 麦克风（audiohat），并解除静音/设音量
sleep 3
pactl set-default-source alsa_input.platform-soc_107c000000_sound.stereo-fallback 2>/dev/null
pactl set-source-mute alsa_input.platform-soc_107c000000_sound.stereo-fallback 0 2>/dev/null
pactl set-source-volume alsa_input.platform-soc_107c000000_sound.stereo-fallback 100% 2>/dev/null

# 启动 wayvnc 远程桌面（监听 5900，供 VNC 客户端远程访问）
# 用 sleep 8 + setsid 确保在 Wayland compositor 完全就绪后启动，且不阻塞 labwc
(sleep 8 && setsid wayvnc 0.0.0.0 5900 >/tmp/wayvnc.log 2>&1) &
