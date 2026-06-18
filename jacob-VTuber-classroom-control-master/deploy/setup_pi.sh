#!/usr/bin/env bash
# ============================================================================
# 树莓派端环境配置脚本（Jacob VTuber 课堂管控系统）
#
# 用途：在新树莓派上一次性完成课堂环境配置。可重复运行（幂等）。
#
# 覆盖：
#   1. 部署课堂精简版 conf.yaml（从 config_templates/conf.classroom.yaml）
#   2. 配置 labwc autostart（外接屏自动切换 + 音频输入持久化）
#   3. 禁用冲突的 set-dsi-left.desktop
#   4. 设置 wm8960 麦克风为默认音频输入
#
# 用法（在树莓派上）：
#   cd ~/Open-LLM-VTuber
#   bash /path/to/setup_pi.sh
#
# 详见 HANDOFF.md 第 12.14 节。
# ============================================================================
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/Open-LLM-VTuber}"
CONF_FILE="${PROJECT_DIR}/conf.yaml"
TEMPLATE="${PROJECT_DIR}/config_templates/conf.classroom.yaml"

echo "========== 1. 部署课堂精简版 conf.yaml =========="
if [ ! -f "${TEMPLATE}" ]; then
    echo "错误：找不到模板 ${TEMPLATE}"
    echo "请先从本地仓库同步 config_templates/conf.classroom.yaml 到树莓派"
    exit 1
fi

# 备份现有 conf.yaml（如果存在）
if [ -f "${CONF_FILE}" ]; then
    BACKUP="${CONF_FILE}.bak.$(date +%s)"
    cp "${CONF_FILE}" "${BACKUP}"
    echo "已备份现有配置到 ${BACKUP}"
fi

# 复制模板
cp "${TEMPLATE}" "${CONF_FILE}"
echo "已部署课堂精简模板到 ${CONF_FILE}"

# 如果备份里有真实密钥，继承过去（避免手动填 TODO）
if [ -n "${BACKUP:-}" ] && [ -f "${BACKUP}" ]; then
    python3 - "${BACKUP}" "${CONF_FILE}" <<'PYEOF'
import sys, yaml
old_path, new_path = sys.argv[1], sys.argv[2]
old = yaml.safe_load(open(old_path))
new = yaml.safe_load(open(new_path))

def fill(old_cfg, new_cfg, path=""):
    """从旧配置继承密钥类字段（非 TODO 占位符才覆盖）。"""
    if isinstance(old_cfg, dict) and isinstance(new_cfg, dict):
        for k in new_cfg:
            if k in old_cfg:
                ov = old_cfg[k]
                nv = new_cfg[k]
                if isinstance(nv, str) and "TODO_FILL" in nv:
                    # 占位符：用旧值填充
                    if isinstance(ov, str) and ov:
                        new_cfg[k] = ov
                        print(f"  继承 {path}{k}: {ov[:8]}...")
                elif isinstance(ov, dict):
                    fill(ov, nv, f"{path}{k}.")

fill(old, new)
yaml.dump(new, open(new_path, 'w'), allow_unicode=True, default_flow_style=False, sort_keys=False)
print("密钥继承完成")
PYEOF
fi
echo "conf.yaml 部署完成"

echo ""
echo "========== 2. 配置 labwc autostart（屏幕 + 音频）=========="
LABWC_DIR="${HOME}/.config/labwc"
mkdir -p "${LABWC_DIR}"
AUTOSTART="${LABWC_DIR}/autostart"

# 备份现有
if [ -f "${AUTOSTART}" ]; then
    cp "${AUTOSTART}" "${AUTOSTART}.bak.$(date +%s)"
fi

cat > "${AUTOSTART}" <<'AUTOSTART_EOF'
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
AUTOSTART_EOF

chmod +x "${AUTOSTART}"
echo "labwc autostart 已配置（屏幕智能切换 + 音频持久化）"

echo ""
echo "========== 3. 禁用冲突的 set-dsi-left.desktop =========="
AUTOSTART_DIR="${HOME}/.config/autostart"
if [ -f "${AUTOSTART_DIR}/set-dsi-left.desktop" ]; then
    mv "${AUTOSTART_DIR}/set-dsi-left.desktop" "${AUTOSTART_DIR}/set-dsi-left.desktop.disabled"
    echo "已禁用 set-dsi-left.desktop（与 labwc autostart 冲突）"
else
    echo "set-dsi-left.desktop 已不存在或已禁用，跳过"
fi

echo ""
echo "========== 4. 立即应用音频配置 =========="
MIC_SOURCE="alsa_input.platform-soc_107c000000_sound.stereo-fallback"
if pactl list short sources 2>/dev/null | grep -q "${MIC_SOURCE}"; then
    pactl set-default-source "${MIC_SOURCE}" 2>/dev/null && echo "默认音频输入已设为 ${MIC_SOURCE}"
    pactl set-source-mute "${MIC_SOURCE}" 0 2>/dev/null
    pactl set-source-volume "${MIC_SOURCE}" 100% 2>/dev/null
    echo "音频配置已应用（解除静音 + 100% 音量）"
else
    echo "警告：未找到音频源 ${MIC_SOURCE}，请确认 wm8960 audiohat 硬件已识别"
    echo "可用音频源："
    pactl list short sources 2>/dev/null || echo "  pactl 不可用"
fi

echo ""
echo "========== 配置完成 =========="
echo "后续步骤："
echo "  1. 确认 conf.yaml 中的密钥已填入（llm_api_key / appid / access_token）"
echo "  2. 重启后端：cd ${PROJECT_DIR} && .venv/bin/python run_server.py"
echo "  3. 或重启树莓派让 labwc autostart 生效"
echo ""
echo "验证："
echo "  - arecord -l        （应有 wm8960 capture 设备）"
echo "  - pactl get-default-source （应为 alsa_input...）"
echo "  - ss -tlnp | grep 12393  （后端端口）"
