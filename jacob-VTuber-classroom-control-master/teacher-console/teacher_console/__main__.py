from __future__ import annotations

import argparse
import os
import threading
from pathlib import Path

import uvicorn

from .app import create_app


def default_data_dir() -> Path:
    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "JacobTeacherConsole"
    return Path.home() / ".jacob-teacher-console"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Jacob VTuber teacher console")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", default=str(default_data_dir()))
    parser.add_argument(
        "--no-window",
        action="store_true",
        help="不打开 pywebview 窗口（测试/无头环境用）",
    )
    parser.add_argument(
        "--no-auth",
        action="store_true",
        help="关闭登录鉴权（仅测试用）",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app = create_app(Path(args.data_dir), enable_auth=not args.no_auth)
    url = f"http://{args.host}:{args.port}"

    if args.no_window:
        # 无窗口模式：仅启动后端（测试/服务化场景）
        uvicorn.run(app, host=args.host, port=args.port)
        return

    # pywebview 桌面窗口形态（PRD T-1）：无边框/无地址栏/无书签栏
    try:
        import webview
    except ImportError:
        # pywebview 缺失时回退到浏览器
        import webbrowser
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        uvicorn.run(app, host=args.host, port=args.port)
        return

    # 后端在子线程跑，主线程跑 pywebview 窗口
    server_thread = threading.Thread(
        target=uvicorn.run,
        kwargs={"app": app, "host": args.host, "port": args.port, "log_level": "warning"},
        daemon=True,
    )
    server_thread.start()

    webview.create_window(
        title="Jacob VTuber 课堂管控台",
        url=url,
        width=1280,
        height=800,
        min_size=(960, 600),
    )
    webview.start()
    # 窗口关闭后退出进程


if __name__ == "__main__":
    main()
