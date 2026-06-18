import io
import json
import zipfile
from pathlib import Path

import pytest
import yaml

from open_llm_vtuber.classroom.storage import (
    UserRegistry,
    SavePointStore,
    build_export_zip,
    create_profile,
    ensure_safe_username,
    get_profile,
    merge_profile_character_config,
    profile_dir_for_username,
    profile_knowledge_directory,
    rename_user,
    restore_profile_chat_history,
    save_profile_from_character_config,
    save_profile_from_context,
    snapshot_profile_chat_history,
)
from open_llm_vtuber.knowledge_service import (
    add_knowledge_file,
    export_knowledge_snapshot,
    get_knowledge_overview,
    initialize_empty_knowledge_snapshot,
    restore_knowledge_snapshot,
)


class DummyCharacterConfig:
    def __init__(self, payload):
        self.payload = payload

    def model_dump(self, **kwargs):
        return dict(self.payload)


class DummyContext:
    def __init__(self, username=None, payload=None):
        self.classroom_username = username
        self.character_config = DummyCharacterConfig(payload or {})


def sample_character_config(character_name="Jacob"):
    return {
        "conf_name": "default",
        "conf_uid": "default_uid",
        "character_name": character_name,
        "human_name": "Student",
        "persona_prompt": "You are a classroom assistant.",
        "avatar_mode": "live2d",
        "avatar_pack_id": "",
        "live2d_model_name": "shizuku",
    }


def test_create_profile_save_and_read(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    profile = create_profile(
        "GroupA01",
        sample_character_config(),
        class_name="三年级一班",
    )
    saved = save_profile_from_character_config(
        profile.username,
        sample_character_config(character_name="Teacher Jacob"),
    )
    loaded = get_profile(profile.username)

    assert loaded is not None
    assert saved.username == loaded.username
    assert loaded.username == "GroupA01"
    assert loaded.class_name == "三年级一班"
    assert loaded.character_config["character_name"] == "Teacher Jacob"
    assert loaded.character_config["conf_uid"] == profile.username
    assert loaded.schema_version == 2
    assert (tmp_path / "classroom_data" / "profiles" / "GroupA01").is_dir()


def test_profile_dir_uses_username_only(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    profile = create_profile("GroupA02", sample_character_config())
    profile_dir = profile_dir_for_username(profile.username)

    assert profile_dir.resolve().is_relative_to(
        (tmp_path / "classroom_data" / "profiles").resolve()
    )
    # 目录结构是 profiles/{username}/，不再是两级 class/student
    assert profile_dir == Path("classroom_data") / "profiles" / "GroupA02"
    assert yaml.safe_load((profile_dir / "profile.yaml").read_text(encoding="utf-8"))[
        "username"
    ] == "GroupA02"


def test_username_rejects_unsafe_input(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    # username 必须仅字母数字 1-32 字符
    for bad in ["", "has space", "has/slash", "has\\back", "..", "has-dash",
                "has_underscore", "has.dot", "a" * 33, "中文名"]:
        with pytest.raises(ValueError):
            ensure_safe_username(bad)

    # 合法 username
    assert ensure_safe_username("GroupA01") == "GroupA01"
    assert ensure_safe_username("  pi01  ") == "pi01"


def test_export_zip_contains_manifest_and_profile(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    profile = create_profile("GroupA03", sample_character_config(), class_name="Class A")
    export_bytes = build_export_zip(profile.username)

    with zipfile.ZipFile(io.BytesIO(export_bytes)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))

    assert {"manifest.json", "profile.yaml"}.issubset(names)
    assert manifest["username"] == profile.username
    assert manifest["class_name"] == "Class A"
    # manifest 不应再含 profile_id / class_slug / student_slug
    assert "profile_id" not in manifest
    assert "class_slug" not in manifest
    assert "student_slug" not in manifest


def test_save_without_current_profile_does_not_write_conf_yaml(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    conf_path = tmp_path / "conf.yaml"
    conf_path.write_text("sentinel: true\n", encoding="utf-8")
    context = DummyContext(payload=sample_character_config())

    with pytest.raises(ValueError):
        save_profile_from_context(context)

    assert conf_path.read_text(encoding="utf-8") == "sentinel: true\n"


def test_profile_v2_excludes_runtime_secrets(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    config = sample_character_config()
    config.update(
        {
            "agent_config": {
                "llm_configs": {
                    "openai_compatible_llm": {
                        "llm_api_key": "sk-sensitive-value",
                    }
                }
            },
            "tts_config": {"api_key": "tts-secret"},
            "asr_config": {"secret_key": "asr-secret"},
        }
    )

    profile = create_profile("GroupA04", config)
    profile_yaml = (
        profile_dir_for_username(profile.username) / "profile.yaml"
    ).read_text(encoding="utf-8")
    export_bytes = build_export_zip(profile.username)

    assert profile.schema_version == 2
    assert "agent_config" not in profile.character_config
    assert "sk-sensitive-value" not in profile_yaml
    assert "tts-secret" not in profile_yaml
    assert "asr-secret" not in profile_yaml
    assert b"sk-sensitive-value" not in export_bytes
    assert b"tts-secret" not in export_bytes


def test_pending_sync_field_persists(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    profile = create_profile(
        "GroupA05", sample_character_config(), pending_sync=True
    )
    assert profile.pending_sync is True

    loaded = get_profile("GroupA05")
    assert loaded is not None
    assert loaded.pending_sync is True


def test_legacy_profile_fields_merge_into_current_runtime_config():
    base = {
        "conf_name": "default",
        "conf_uid": "default_uid",
        "character_name": "Base",
        "persona_prompt": "Base prompt",
        "agent_config": {"api_key": "runtime-only-secret"},
        "tts_config": {"api_key": "runtime-tts-secret"},
    }
    legacy = {
        "character_name": "Student Character",
        "persona_prompt": "Student prompt",
        "agent_config": {"api_key": "legacy-secret-must-not-load"},
    }

    merged = merge_profile_character_config(base, legacy)

    assert merged["character_name"] == "Student Character"
    assert merged["persona_prompt"] == "Student prompt"
    assert merged["agent_config"]["api_key"] == "runtime-only-secret"
    assert merged["tts_config"]["api_key"] == "runtime-tts-secret"


def test_profiles_keep_knowledge_and_chat_history_isolated(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    alice = create_profile("Alice01", sample_character_config())
    bob = create_profile("Bob02", sample_character_config())

    add_knowledge_file("alice.txt", b"Alice private notes")
    export_knowledge_snapshot(profile_knowledge_directory(alice.username))
    alice_chat = tmp_path / "chat_history" / alice.username
    alice_chat.mkdir(parents=True)
    (alice_chat / "history.json").write_text('{"student":"Alice"}', encoding="utf-8")
    snapshot_profile_chat_history(alice.username)

    restore_knowledge_snapshot(profile_knowledge_directory(bob.username))
    assert get_knowledge_overview()["file_count"] == 0
    add_knowledge_file("bob.txt", b"Bob private notes")
    export_knowledge_snapshot(profile_knowledge_directory(bob.username))

    restore_knowledge_snapshot(profile_knowledge_directory(alice.username))
    overview = get_knowledge_overview()
    assert overview["file_count"] == 1
    assert overview["files"][0]["name"] == "alice.txt"

    shutil_target = tmp_path / "chat_history" / alice.username
    shutil_target.rename(tmp_path / "alice-chat-backup")
    restore_profile_chat_history(alice.username)
    assert (shutil_target / "history.json").read_text(encoding="utf-8") == (
        '{"student":"Alice"}'
    )


def test_new_profile_knowledge_snapshot_starts_empty(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    alice = create_profile("Alice03", sample_character_config())
    bob = create_profile("Bob04", sample_character_config())

    add_knowledge_file("alice.txt", b"Alice private notes")
    export_knowledge_snapshot(profile_knowledge_directory(alice.username))
    initialize_empty_knowledge_snapshot(profile_knowledge_directory(bob.username))
    restore_knowledge_snapshot(profile_knowledge_directory(bob.username))

    assert get_knowledge_overview()["file_count"] == 0


# ---------------------------------------------------------------------------
# 新增：UserRegistry / SavePointStore / rename_user（开发文档 §3.4 / §3.6 / §5.2）
# ---------------------------------------------------------------------------


def test_user_registry_register_and_dedup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    registry = UserRegistry()
    entry = registry.register("GroupA06", pending_sync=False)
    assert entry["username"] == "GroupA06"
    assert registry.exists("GroupA06") is True
    assert registry.exists("GroupA99") is False

    # 重复注册不报错，更新 last_login_at
    again = registry.register("GroupA06", pending_sync=True)
    assert again["username"] == "GroupA06"
    assert again["pending_sync"] is True

    # pending 列表
    pending = registry.list_pending()
    assert len(pending) == 1
    assert pending[0]["username"] == "GroupA06"

    # mark_synced
    registry.mark_synced("GroupA06")
    assert registry.get("GroupA06")["pending_sync"] is False
    assert registry.list_pending() == []


def test_user_registry_rename_and_remove(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    registry = UserRegistry()
    registry.register("OldName", pending_sync=True)
    registry.rename("OldName", "NewName")
    assert registry.exists("OldName") is False
    assert registry.exists("NewName") is True
    assert registry.get("NewName")["pending_sync"] is False

    registry.remove("NewName")
    assert registry.exists("NewName") is False


def test_save_point_store_crud(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    create_profile("GroupA07", sample_character_config())
    store = SavePointStore("GroupA07")

    assert store.list_saves() == []
    assert store.get("20260617-093000") is None

    meta = store.create(
        "20260617-093000", b"zip-bytes", label="第二课完成"
    )
    assert meta["save_id"] == "20260617-093000"
    assert meta["username"] == "GroupA07"
    assert meta["label"] == "第二课完成"

    saves = store.list_saves()
    assert len(saves) == 1
    assert saves[0]["save_id"] == "20260617-093000"

    assert store.get("20260617-093000")["label"] == "第二课完成"
    assert store.snapshot_path("20260617-093000").read_bytes() == b"zip-bytes"

    store.delete("20260617-093000")
    assert store.list_saves() == []
    with pytest.raises(FileNotFoundError):
        store.snapshot_path("20260617-093000")


def test_rename_user_migrates_directory_and_profile(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    profile = create_profile("OldUser", sample_character_config(), class_name="C1")
    old_dir = profile_dir_for_username("OldUser")
    assert old_dir.is_dir()

    # 预置 chat_history 顶层目录
    old_chat = tmp_path / "chat_history" / "OldUser"
    old_chat.mkdir(parents=True)
    (old_chat / "h.json").write_text("{}", encoding="utf-8")

    from open_llm_vtuber.classroom.storage import save_runtime_state
    save_runtime_state(current_username="OldUser")

    new_profile = rename_user("OldUser", "NewUser")
    assert new_profile.username == "NewUser"
    assert new_profile.character_config["conf_uid"] == "NewUser"
    assert profile_dir_for_username("OldUser").is_dir() is False
    assert profile_dir_for_username("NewUser").is_dir() is True

    # chat_history 顶层目录也应迁移
    assert (tmp_path / "chat_history" / "NewUser" / "h.json").is_file()
    assert old_chat.exists() is False

    # runtime_state 同步更新
    from open_llm_vtuber.classroom.storage import load_runtime_state
    assert load_runtime_state()["current_username"] == "NewUser"


def test_rename_user_rejects_existing_target(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    create_profile("UserX", sample_character_config())
    create_profile("UserY", sample_character_config())
    with pytest.raises(ValueError):
        rename_user("UserX", "UserY")
