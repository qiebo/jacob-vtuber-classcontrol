# Jacob VTuber 教师端 V1

轻量教师端管控软件，面向同一局域网内至少 16 台树莓派学生设备。教师机只需运行一个 EXE，随后在浏览器中使用管控界面。

## 已实现功能

- 16 台设备并发在线状态刷新，单台离线不会阻塞全班
- CIDR `/24` 局域网发现和批量导入
- 每台设备独立令牌鉴权，教师端接口不会返回令牌
- 实时设备缩略图、学生档案、保存/提交和锁定状态
- 单台与批量锁定、解锁
- 向选中设备并发分发最大 50 MB 文件
- 单台与批量收集学生档案 ZIP，采用流式下载和临时文件原子替换
- 多学生档案隔离：角色、外观、背景、作品文件、知识库和聊天记录

## 教师机直接使用 EXE

运行：

```powershell
dist\JacobTeacherConsole.exe
```

程序默认监听 `127.0.0.1:8765` 并打开浏览器。设备清单和收集结果保存在：

```text
%LOCALAPPDATA%\JacobTeacherConsole\
```

作品目录：

```text
%LOCALAPPDATA%\JacobTeacherConsole\collections\YYYY-MM-DD\
```

可选启动参数：

```powershell
dist\JacobTeacherConsole.exe --port 8877 --no-open --data-dir D:\JacobClassroom
```

## 从源码启动

```powershell
python -m pip install -r teacher-console\requirements.txt
$env:PYTHONPATH="teacher-console"
python -m teacher_console
```

## 构建 Windows 单文件程序

```powershell
powershell -ExecutionPolicy Bypass -File teacher-console\build_windows.ps1
```

输出为 `dist\JacobTeacherConsole.exe`。当前验收构建约 43 MB。

## 树莓派学生端配置

1. 将 `.classroom.env.example` 复制为 `.classroom.env`。
2. 为每台设备设置唯一的 `JACOB_DEVICE_ID` 和 `JACOB_DEVICE_NAME`。
3. 16 台设备使用同一个足够随机的 `JACOB_CLASSROOM_TOKEN`，教师端添加或发现设备时填写相同令牌。
4. 确认 `conf.yaml` 的服务地址允许局域网访问，端口默认为 `12393`。
5. 使用 `scripts/raspberry_pi/start_vtuber_fullscreen.sh` 启动。

示例：

```dotenv
JACOB_DEVICE_ID=pi-01
JACOB_DEVICE_NAME=第一组设备
JACOB_CLASSROOM_TOKEN=replace-with-a-shared-random-token
```

本机浏览器访问学生端接口时允许免令牌；来自教师机的局域网请求必须携带正确令牌。

## 课堂操作流程

1. 启动 16 台树莓派并确认处于同一网段。
2. 打开教师端 EXE，在“局域网发现”填写网段、端口和令牌。
3. 导入设备并执行“立即刷新”，确认设备显示在线和缩略图。
4. 勾选设备后执行批量锁定、解锁或文件分发。
5. 学生创建或载入自己的档案后开展活动，并保存或提交。
6. 教师点击“收集作品”，ZIP 自动保存到教师机收集目录。

## 验收命令

```powershell
$env:PYTHONPATH="src"
python -m pytest tests\test_classroom_storage.py tests\test_classroom_api.py -q

$env:PYTHONPATH="teacher-console"
python -m pytest teacher-console\tests\test_teacher_console.py -q
python -m pytest teacher-console\tests\test_teacher_console_16_devices.py -q -s

cd frontend-source
npm run build:web
```

16 台集成测试使用真实本地 HTTP 服务，覆盖状态刷新、锁定、5 MB 文件分发、作品收集、快照代理，以及 12 台在线加 4 台离线故障场景。
