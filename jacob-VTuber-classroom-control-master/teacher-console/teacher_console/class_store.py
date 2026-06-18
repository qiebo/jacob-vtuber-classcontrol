"""班级定义存储（开发文档 §3.2 / §4.3.2）。

存储 teacher_console_data/classes.json。
删除班级时学生回未分班（class_id=null），由 app 层调用 UserStore.update_class 实现。
"""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CLASS_ID_RE = re.compile(r"^cls_[A-Za-z0-9_-]{1,40}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ClassStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.path = data_dir / "classes.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {"version": 1, "classes": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("classes"), list):
                return {"version": 1, "classes": []}
            return data
        except Exception:
            return {"version": 1, "classes": []}

    def _save(self, data: dict[str, Any]) -> None:
        self.path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def list_classes(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._load().get("classes", []))

    def get(self, class_id: str) -> dict[str, Any] | None:
        with self._lock:
            for cls in self._load().get("classes", []):
                if cls.get("class_id") == class_id:
                    return cls
        return None

    def create(self, name: str) -> dict[str, Any]:
        name = (name or "").strip()
        if not name or len(name) > 32:
            raise ValueError("班级名称需为 1–32 字符")
        with self._lock:
            data = self._load()
            classes: list[dict[str, Any]] = data.get("classes", [])
            for cls in classes:
                if cls.get("name") == name:
                    raise ValueError("班级名称已存在")
            # 生成 class_id
            import secrets
            class_id = f"cls_{secrets.token_hex(6)}"
            while any(c.get("class_id") == class_id for c in classes):
                class_id = f"cls_{secrets.token_hex(6)}"
            entry = {
                "class_id": class_id,
                "name": name,
                "created_at": utc_now_iso(),
            }
            classes.append(entry)
            data["classes"] = classes
            self._save(data)
            return entry

    def rename(self, class_id: str, name: str) -> dict[str, Any] | None:
        name = (name or "").strip()
        if not name or len(name) > 32:
            raise ValueError("班级名称需为 1–32 字符")
        with self._lock:
            data = self._load()
            for cls in data.get("classes", []):
                if cls.get("name") == name and cls.get("class_id") != class_id:
                    raise ValueError("班级名称已存在")
            for cls in data.get("classes", []):
                if cls.get("class_id") == class_id:
                    cls["name"] = name
                    self._save(data)
                    return cls
        return None

    def delete(self, class_id: str) -> bool:
        with self._lock:
            data = self._load()
            classes = data.get("classes", [])
            remaining = [c for c in classes if c.get("class_id") != class_id]
            if len(remaining) == len(classes):
                return False
            data["classes"] = remaining
            self._save(data)
            return True
