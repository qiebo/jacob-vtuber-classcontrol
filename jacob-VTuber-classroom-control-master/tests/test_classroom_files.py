import io
import zipfile

import pytest

from open_llm_vtuber.classroom.storage import (
    build_export_zip,
    create_profile,
    delete_profile_file,
    get_profile_file,
    list_profile_files,
    save_profile_file,
)


def sample_character_config():
    return {
        "conf_name": "default",
        "conf_uid": "default_uid",
        "character_name": "Jacob",
        "human_name": "Student",
        "persona_prompt": "You are a classroom assistant.",
    }


def test_profile_file_lifecycle(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    profile = create_profile("Alice01", sample_character_config())

    saved = save_profile_file(profile.username, "draft.txt", b"hello classroom")
    listed = list_profile_files(profile.username)
    path = get_profile_file(profile.username, "draft.txt")

    assert saved.name == "draft.txt"
    assert saved.size == len(b"hello classroom")
    assert [item.name for item in listed] == ["draft.txt"]
    assert path.read_bytes() == b"hello classroom"

    delete_profile_file(profile.username, "draft.txt")

    assert list_profile_files(profile.username) == []
    with pytest.raises(FileNotFoundError):
        get_profile_file(profile.username, "draft.txt")


@pytest.mark.parametrize(
    "filename",
    [
        "",
        "../secret.txt",
        "..\\secret.txt",
        "nested/file.txt",
        "bad:name.txt",
    ],
)
def test_profile_file_rejects_unsafe_names(tmp_path, monkeypatch, filename):
    monkeypatch.chdir(tmp_path)
    profile = create_profile("Alice02", sample_character_config())

    with pytest.raises(ValueError):
        save_profile_file(profile.username, filename, b"unsafe")


def test_export_zip_contains_profile_files(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    profile = create_profile("Alice03", sample_character_config())
    save_profile_file(profile.username, "作品.txt", "数字人作品".encode("utf-8"))

    export_bytes = build_export_zip(profile.username)

    with zipfile.ZipFile(io.BytesIO(export_bytes)) as archive:
        names = set(archive.namelist())
        content = archive.read("files/作品.txt").decode("utf-8")

    assert "files/作品.txt" in names
    assert content == "数字人作品"
