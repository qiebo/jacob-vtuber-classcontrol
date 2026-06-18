from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4
from xml.etree import ElementTree

from loguru import logger

SUPPORTED_KNOWLEDGE_EXTENSIONS = {".txt", ".pdf", ".docx"}
MAX_KNOWLEDGE_FILE_COUNT = 5
MAX_KNOWLEDGE_SINGLE_FILE_BYTES = 2 * 1024 * 1024
MAX_KNOWLEDGE_TOTAL_BYTES = 8 * 1024 * 1024
DEFAULT_KNOWLEDGE_TOP_K = 3
DEFAULT_KNOWLEDGE_MAX_CHARS = 1200
DEFAULT_KNOWLEDGE_TIMEOUT_MS = 40

_CHUNK_SIZE_CHARS = 480
_CHUNK_OVERLAP_CHARS = 80
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]")

KNOWLEDGE_BASE_DIR = Path("knowledge_base")
KNOWLEDGE_FILES_DIR = KNOWLEDGE_BASE_DIR / "files"
KNOWLEDGE_INDEX_PATH = KNOWLEDGE_BASE_DIR / "index.json"

_INDEX_CACHE: dict[str, Any] | None = None
_INDEX_MTIME: float | None = None


def reset_knowledge_cache() -> None:
    global _INDEX_CACHE, _INDEX_MTIME

    _INDEX_CACHE = None
    _INDEX_MTIME = None


def export_knowledge_snapshot(target_dir: Path) -> None:
    target_dir = Path(target_dir)
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    if KNOWLEDGE_BASE_DIR.is_dir():
        shutil.copytree(KNOWLEDGE_BASE_DIR, target_dir)
        return

    (target_dir / "files").mkdir(parents=True, exist_ok=True)
    (target_dir / "index.json").write_text(
        json.dumps(_default_index(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def initialize_empty_knowledge_snapshot(target_dir: Path) -> None:
    target_dir = Path(target_dir)
    if target_dir.exists():
        return
    (target_dir / "files").mkdir(parents=True, exist_ok=True)
    (target_dir / "index.json").write_text(
        json.dumps(_default_index(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def restore_knowledge_snapshot(source_dir: Path) -> None:
    source_dir = Path(source_dir)
    if KNOWLEDGE_BASE_DIR.exists():
        shutil.rmtree(KNOWLEDGE_BASE_DIR)
    if source_dir.is_dir():
        shutil.copytree(source_dir, KNOWLEDGE_BASE_DIR)
    else:
        KNOWLEDGE_FILES_DIR.mkdir(parents=True, exist_ok=True)
        KNOWLEDGE_INDEX_PATH.write_text(
            json.dumps(_default_index(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    reset_knowledge_cache()
    _load_index(force_refresh=True)


def _ensure_dirs() -> None:
    KNOWLEDGE_FILES_DIR.mkdir(parents=True, exist_ok=True)


def _default_index() -> dict[str, Any]:
    return {"version": 1, "files": [], "chunks": []}


def _normalize_index(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _default_index()

    files = raw.get("files")
    chunks = raw.get("chunks")
    if not isinstance(files, list):
        files = []
    if not isinstance(chunks, list):
        chunks = []

    normalized_files: list[dict[str, Any]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        file_id = str(item.get("id") or "").strip()
        stored_name = str(item.get("stored_name") or "").strip()
        if not file_id or not stored_name:
            continue
        normalized_files.append(
            {
                "id": file_id,
                "name": str(item.get("name") or stored_name),
                "stored_name": stored_name,
                "extension": str(item.get("extension") or "").lower(),
                "size_bytes": int(item.get("size_bytes") or 0),
                "uploaded_at": str(item.get("uploaded_at") or ""),
                "chunk_count": int(item.get("chunk_count") or 0),
            }
        )

    normalized_chunks: list[dict[str, Any]] = []
    for item in chunks:
        if not isinstance(item, dict):
            continue
        chunk_id = str(item.get("id") or "").strip()
        file_id = str(item.get("file_id") or "").strip()
        text = str(item.get("text") or "").strip()
        if not chunk_id or not file_id or not text:
            continue
        terms = item.get("terms")
        if not isinstance(terms, list):
            terms = _tokenize(text)
        normalized_chunks.append(
            {
                "id": chunk_id,
                "file_id": file_id,
                "text": text,
                "terms": [str(token) for token in terms[:256]],
            }
        )

    return {"version": 1, "files": normalized_files, "chunks": normalized_chunks}


def _load_index(force_refresh: bool = False) -> dict[str, Any]:
    global _INDEX_CACHE, _INDEX_MTIME

    _ensure_dirs()
    if not KNOWLEDGE_INDEX_PATH.exists():
        default_data = _default_index()
        _save_index(default_data)
        return default_data

    mtime = KNOWLEDGE_INDEX_PATH.stat().st_mtime
    if (
        not force_refresh
        and _INDEX_CACHE is not None
        and _INDEX_MTIME is not None
        and _INDEX_MTIME == mtime
    ):
        return _INDEX_CACHE

    try:
        raw_data = json.loads(KNOWLEDGE_INDEX_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error(f"Failed to read knowledge index: {exc}")
        raw_data = _default_index()

    normalized = _normalize_index(raw_data)
    _INDEX_CACHE = normalized
    _INDEX_MTIME = mtime
    return normalized


def _save_index(index_data: dict[str, Any]) -> None:
    global _INDEX_CACHE, _INDEX_MTIME

    _ensure_dirs()
    normalized = _normalize_index(index_data)
    KNOWLEDGE_INDEX_PATH.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    _INDEX_CACHE = normalized
    _INDEX_MTIME = KNOWLEDGE_INDEX_PATH.stat().st_mtime


def _tokenize(text: str) -> list[str]:
    tokens = [match.group(0).lower() for match in _TOKEN_PATTERN.finditer(text)]
    if tokens:
        return tokens

    compact = re.sub(r"\s+", "", text.lower())
    if len(compact) <= 1:
        return []
    return [compact[i : i + 2] for i in range(len(compact) - 1)]


def _chunk_text(content: str) -> list[str]:
    normalized = re.sub(r"\r\n?", "\n", content)
    normalized = re.sub(r"[ \t]+", " ", normalized).strip()
    if not normalized:
        return []

    compact = normalized
    chunks: list[str] = []
    start = 0
    text_length = len(compact)
    while start < text_length:
        end = min(text_length, start + _CHUNK_SIZE_CHARS)
        chunk = compact[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= text_length:
            break
        start = max(0, end - _CHUNK_OVERLAP_CHARS)

    return chunks[:200]


def _extract_text_from_txt(content: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gbk", "gb2312", "cp936"):
        try:
            return content.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore").strip()


def _extract_text_from_docx(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if "word/document.xml" not in archive.namelist():
                raise ValueError("The .docx file does not contain word/document.xml.")
            xml_bytes = archive.read("word/document.xml")
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid .docx file.") from exc

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as exc:
        raise ValueError("Failed to parse the .docx document XML.") from exc

    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        texts = [node.text for node in paragraph.findall(".//w:t", namespace) if node.text]
        if texts:
            paragraphs.append("".join(texts).strip())

    return "\n".join([line for line in paragraphs if line]).strip()


def _extract_text_from_pdf(content: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_file:
        temp_file.write(content)
        temp_pdf_path = Path(temp_file.name)

    try:
        command = ["pdftotext", "-layout", str(temp_pdf_path), "-"]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if completed.returncode != 0:
            stderr = completed.stderr.strip()
            raise ValueError(stderr or "pdftotext failed to process this PDF.")
        return completed.stdout.strip()
    except FileNotFoundError as exc:
        raise ValueError("pdftotext is not installed on this system.") from exc
    finally:
        temp_pdf_path.unlink(missing_ok=True)


def _extract_text(extension: str, content: bytes) -> str:
    if extension == ".txt":
        return _extract_text_from_txt(content)
    if extension == ".pdf":
        return _extract_text_from_pdf(content)
    if extension == ".docx":
        return _extract_text_from_docx(content)
    raise ValueError(f"Unsupported file format: {extension}")


def _sanitize_filename(filename: str) -> tuple[str, str]:
    raw_name = Path(filename or "").name
    stem = Path(raw_name).stem
    extension = Path(raw_name).suffix.lower()

    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    if not safe_stem:
        safe_stem = "knowledge_file"
    return safe_stem, extension


def _get_display_filename(filename: str, extension: str) -> str:
    raw_name = Path(filename or "").name.strip()
    if raw_name:
        return raw_name
    base_name = "knowledge_file"
    return f"{base_name}{extension}"


def _calc_total_size(file_entries: list[dict[str, Any]]) -> int:
    return sum(int(item.get("size_bytes") or 0) for item in file_entries)


def get_knowledge_overview() -> dict[str, Any]:
    index_data = _load_index()
    files = sorted(
        index_data["files"],
        key=lambda item: item.get("uploaded_at") or "",
        reverse=True,
    )
    return {
        "files": files,
        "file_count": len(files),
        "total_size_bytes": _calc_total_size(files),
        "limits": {
            "max_files": MAX_KNOWLEDGE_FILE_COUNT,
            "max_total_size_bytes": MAX_KNOWLEDGE_TOTAL_BYTES,
            "max_single_file_bytes": MAX_KNOWLEDGE_SINGLE_FILE_BYTES,
            "supported_extensions": sorted(SUPPORTED_KNOWLEDGE_EXTENSIONS),
        },
    }


def add_knowledge_file(filename: str, content: bytes) -> dict[str, Any]:
    if not content:
        raise ValueError("Empty file is not allowed.")

    _, extension = _sanitize_filename(filename)
    if extension not in SUPPORTED_KNOWLEDGE_EXTENSIONS:
        allowed = ", ".join(sorted(SUPPORTED_KNOWLEDGE_EXTENSIONS))
        raise ValueError(f"Unsupported file type. Allowed: {allowed}")

    file_size = len(content)
    if file_size > MAX_KNOWLEDGE_SINGLE_FILE_BYTES:
        raise ValueError(
            f"File is too large (max {MAX_KNOWLEDGE_SINGLE_FILE_BYTES // (1024 * 1024)}MB)."
        )

    index_data = _load_index()
    file_entries = index_data["files"]
    if len(file_entries) >= MAX_KNOWLEDGE_FILE_COUNT:
        raise ValueError(f"At most {MAX_KNOWLEDGE_FILE_COUNT} files are allowed.")

    current_total = _calc_total_size(file_entries)
    if current_total + file_size > MAX_KNOWLEDGE_TOTAL_BYTES:
        max_mb = MAX_KNOWLEDGE_TOTAL_BYTES // (1024 * 1024)
        raise ValueError(f"Total knowledge size cannot exceed {max_mb}MB.")

    extracted_text = _extract_text(extension, content)
    if not extracted_text:
        raise ValueError("No readable text found in the uploaded file.")

    chunks = _chunk_text(extracted_text)
    if not chunks:
        raise ValueError("No valid text chunks could be generated from this file.")

    file_id = uuid4().hex
    stored_name = f"{file_id}{extension}"
    _ensure_dirs()
    (KNOWLEDGE_FILES_DIR / stored_name).write_bytes(content)

    uploaded_at = datetime.now(timezone.utc).isoformat()
    display_name = _get_display_filename(filename, extension)
    file_entry = {
        "id": file_id,
        "name": display_name,
        "stored_name": stored_name,
        "extension": extension,
        "size_bytes": file_size,
        "uploaded_at": uploaded_at,
        "chunk_count": len(chunks),
    }

    chunk_entries: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        chunk_entries.append(
            {
                "id": f"{file_id}_{index + 1}",
                "file_id": file_id,
                "text": chunk,
                "terms": _tokenize(chunk)[:256],
            }
        )

    index_data["files"].append(file_entry)
    index_data["chunks"].extend(chunk_entries)
    _save_index(index_data)
    logger.info(
        f"Knowledge file added: {display_name}, chunks={len(chunk_entries)}, size={file_size}B"
    )
    return file_entry


def delete_knowledge_file(file_id: str) -> dict[str, Any]:
    safe_file_id = re.sub(r"[^A-Za-z0-9]+", "", (file_id or "").strip())
    if not safe_file_id:
        raise ValueError("Invalid file id.")

    index_data = _load_index()
    file_entries: list[dict[str, Any]] = index_data["files"]
    target = next((item for item in file_entries if item.get("id") == safe_file_id), None)
    if not target:
        raise KeyError("Knowledge file not found.")

    stored_name = str(target.get("stored_name") or "").strip()
    if stored_name:
        file_path = KNOWLEDGE_FILES_DIR / stored_name
        file_path.unlink(missing_ok=True)

    index_data["files"] = [item for item in file_entries if item.get("id") != safe_file_id]
    index_data["chunks"] = [
        chunk for chunk in index_data["chunks"] if chunk.get("file_id") != safe_file_id
    ]
    _save_index(index_data)
    logger.info(f"Knowledge file deleted: {target.get('name')} ({safe_file_id})")
    return target


def retrieve_knowledge_context(
    query: str,
    top_k: int = DEFAULT_KNOWLEDGE_TOP_K,
    max_chars: int = DEFAULT_KNOWLEDGE_MAX_CHARS,
    timeout_ms: int = DEFAULT_KNOWLEDGE_TIMEOUT_MS,
) -> str:
    question = (query or "").strip()
    if not question:
        return ""

    index_data = _load_index()
    chunks: list[dict[str, Any]] = index_data.get("chunks") or []
    if not chunks:
        return ""

    query_tokens = _tokenize(question)
    if not query_tokens:
        return ""
    query_token_set = set(query_tokens)
    question_lower = question.lower()

    start_time = monotonic()
    scored_chunks: list[tuple[float, dict[str, Any]]] = []
    for chunk in chunks:
        elapsed_ms = (monotonic() - start_time) * 1000
        if elapsed_ms > timeout_ms:
            break

        chunk_text = str(chunk.get("text") or "")
        if not chunk_text:
            continue
        chunk_lower = chunk_text.lower()
        term_list = chunk.get("terms")
        if not isinstance(term_list, list):
            term_list = _tokenize(chunk_text)
        chunk_token_set = set(str(token) for token in term_list)
        overlap = len(query_token_set & chunk_token_set)
        if overlap == 0 and question_lower not in chunk_lower:
            continue

        coverage = overlap / max(1, len(query_token_set))
        density = overlap / max(1, len(chunk_token_set))
        phrase_bonus = 0.6 if question_lower in chunk_lower else 0.0
        score = (coverage * 1.8) + (density * 0.5) + phrase_bonus
        if score > 0:
            scored_chunks.append((score, chunk))

    if not scored_chunks:
        return ""

    scored_chunks.sort(key=lambda item: item[0], reverse=True)
    file_name_map = {
        item.get("id"): str(item.get("name") or "knowledge_file")
        for item in index_data.get("files") or []
        if isinstance(item, dict)
    }

    selected_blocks: list[str] = []
    seen_chunks: set[str] = set()
    current_chars = 0
    for score, chunk in scored_chunks[: max(8, top_k * 3)]:
        chunk_text = str(chunk.get("text") or "").strip()
        if not chunk_text or chunk_text in seen_chunks:
            continue
        seen_chunks.add(chunk_text)

        file_name = file_name_map.get(chunk.get("file_id"), "knowledge_file")
        excerpt = chunk_text if len(chunk_text) <= 320 else f"{chunk_text[:320]}..."
        block = f"[{file_name}] {excerpt}"
        block_length = len(block)
        if current_chars + block_length > max_chars:
            break
        selected_blocks.append(block)
        current_chars += block_length
        if len(selected_blocks) >= top_k:
            break

    if not selected_blocks:
        return ""

    logger.debug(
        f"Knowledge retrieval hit {len(selected_blocks)} chunk(s) in "
        f"{(monotonic() - start_time) * 1000:.2f}ms."
    )
    return "\n\n".join(selected_blocks)
