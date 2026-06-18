# 部署手册（树莓派）

本手册用于快速部署“翼生涯桌面数智人”项目，适配当前仓库代码。

## 1. 前置条件
- 已安装 Python 3.10~3.12（建议优先复用已有虚拟环境）
- 系统可访问网络（安装依赖与下载模型时需要）
- 已安装浏览器（Chromium/Chrome/Firefox 任一）

## 2. 首次部署
```bash
cd ~/Open-LLM-VTuber

# 1) 虚拟环境（优先复用）
if [ -f venv/bin/activate ]; then
  source venv/bin/activate
elif [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
else
  python3 -m venv .venv
  source .venv/bin/activate
fi

# 2) 安装依赖
pip install -U pip
pip install -r requirements.txt

# 3) 启动服务
python run_server.py
```

## 3. 一键课堂模式（桌面图标）
```bash
cd ~/Open-LLM-VTuber
bash scripts/raspberry_pi/install_desktop_shortcut.sh
```

安装后在桌面生成：`翼生涯桌面数智人.desktop`

双击图标会自动：
- 启动后端服务
- 打开网页
- 进入 kiosk 全屏

如需单独在桌面切换横屏/竖屏：
```bash
bash scripts/raspberry_pi/install_orientation_shortcut.sh
```

安装后会生成：`切换横竖屏.desktop`

## 4. 健康检查
```bash
curl -fsS http://127.0.0.1:12393/
curl -fsS http://127.0.0.1:12393/knowledge/files
```

## 5. 停止服务
优先使用网页中的“退出项目”按钮；
或执行：
```bash
bash scripts/raspberry_pi/stop_vtuber.sh
```

## 6. 常见问题
### 6.1 页面打不开（ERR_CONNECTION_REFUSED）
- 确认 `python run_server.py` 是否在运行
- 检查端口占用：`lsof -i :12393`

### 6.2 没有声音
- 检查设置里的 TTS 引擎与鉴权是否已保存
- 切回 `edge_tts` 验证基础链路

### 6.3 麦克风无法启动
- 确认浏览器已授予麦克风权限
- 若是远程访问，需 HTTPS 或 localhost 环境

## 7. 升级流程
```bash
cd ~/Open-LLM-VTuber
git pull --ff-only
source venv/bin/activate  # 或 .venv
pip install -r requirements.txt
```

## 8. 备份建议
当前项目已采用外部备份目录：`/home/yb/backups`。
升级前建议至少保留：
- `conf.yaml`
- `chat_history/`
- `knowledge_base/`
- `live2d-models/`
- `backgrounds/`
