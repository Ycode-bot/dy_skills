#!/usr/bin/env python3
"""Update an installed project-tracking-integrator skill from GitHub.

Exit codes:
  0: checked successfully, disabled, skipped, or already current
  1: update check or installation failed; the caller should continue locally
  2: an update was installed, or --check-only found one
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile


SKILL_NAME = "project-tracking-integrator"
DEFAULT_SOURCE = "Ycode-bot/dy_skills@project-tracking-integrator"
DEFAULT_REF = "main"
AUTO_UPDATE_ENV = "PROJECT_TRACKING_INTEGRATOR_AUTO_UPDATE"
SOURCE_ENV = "PROJECT_TRACKING_INTEGRATOR_SKILL_SOURCE"
REF_ENV = "PROJECT_TRACKING_INTEGRATOR_UPDATE_REF"
CHECK_INTERVAL_ENV = "PROJECT_TRACKING_INTEGRATOR_UPDATE_INTERVAL_HOURS"
RETRY_INTERVAL_ENV = "PROJECT_TRACKING_INTEGRATOR_UPDATE_RETRY_HOURS"
FORCE_UPDATE_ENV = "PROJECT_TRACKING_INTEGRATOR_FORCE_UPDATE"
PRESERVE_NAMES = {".DS_Store", ".update-state.json", ".venv", "node_modules"}
IGNORE_NAMES = PRESERVE_NAMES | {"__pycache__"}
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_EXTRACTED_BYTES = 250 * 1024 * 1024
LOCK_STALE_SECONDS = 120
DEFAULT_CHECK_INTERVAL_HOURS = 24.0
DEFAULT_RETRY_INTERVAL_HOURS = 1.0
STATE_SCHEMA_VERSION = 1


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"从 GitHub 更新 {SKILL_NAME}。")
    parser.add_argument(
        "--source",
        default=os.environ.get(SOURCE_ENV, DEFAULT_SOURCE),
        help="GitHub 来源，格式 owner/repo@skill",
    )
    parser.add_argument("--dest", required=True, help="已安装的 skill 目录")
    parser.add_argument("--ref", default=os.environ.get(REF_ENV, DEFAULT_REF), help="Git 分支或引用")
    parser.add_argument("--timeout", type=int, default=20, help="网络超时秒数")
    parser.add_argument("--check-only", action="store_true", help="只检查更新，不安装")
    parser.add_argument(
        "--force",
        action="store_true",
        default=os.environ.get(FORCE_UPDATE_ENV, "0").strip().lower() in {"1", "true", "yes", "on"},
        help="跳过检查缓存，立即检查 GitHub",
    )
    parser.add_argument(
        "--interval-hours",
        type=float,
        default=os.environ.get(CHECK_INTERVAL_ENV, str(DEFAULT_CHECK_INTERVAL_HOURS)),
        help=f"检查缓存小时数，默认 {DEFAULT_CHECK_INTERVAL_HOURS:g}",
    )
    parser.add_argument(
        "--allow-git-checkout",
        action="store_true",
        help="允许替换 Git 工作区中的 skill 文件",
    )
    return parser.parse_args(argv)


def parse_source(value: str) -> tuple[str, str, str]:
    match = re.fullmatch(
        r"([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)",
        value.strip(),
    )
    if not match:
        raise ValueError("source must use owner/repo@skill with safe GitHub path characters")
    return match.group(1), match.group(2), match.group(3)


def load_update_state(destination: Path) -> dict:
    state_path = destination / ".update-state.json"
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return state if isinstance(state, dict) else {}


def write_update_state(destination: Path, state: dict) -> None:
    state_path = destination / ".update-state.json"
    fd, temporary_name = tempfile.mkstemp(prefix=".update-state-", suffix=".json", dir=destination)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(state, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
        os.replace(temporary_path, state_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def state_matches(state: dict, source: str, ref: str) -> bool:
    return (
        state.get("schema_version") == STATE_SCHEMA_VERSION
        and state.get("source") == source
        and state.get("ref") == ref
    )


def cache_is_fresh(state: dict, source: str, ref: str, now: float) -> bool:
    if not state_matches(state, source, ref):
        return False
    if state.get("update_available") is True and state.get("last_result") != "error":
        return False
    try:
        return float(state.get("next_check_at", 0)) > now
    except (TypeError, ValueError):
        return False


def project_tracking_integrator_cached_message(state: dict) -> str:
    try:
        next_check = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(state["next_check_at"])))
        return f"{SKILL_NAME} 更新检查结果缓存至 {next_check}；明确需要立即检查时使用 --force。"
    except (KeyError, TypeError, ValueError, OSError):
        return f"{SKILL_NAME} 更新检查结果已缓存；明确需要立即检查时使用 --force。"


def build_update_state(
    previous: dict,
    *,
    source: str,
    ref: str,
    now: float,
    next_check_at: float,
    result: str,
    current_remote_sha: str | None = None,
    local_digest: str | None = None,
    update_available: bool = False,
) -> dict:
    state = {
        "schema_version": STATE_SCHEMA_VERSION,
        "source": source,
        "ref": ref,
        "last_checked_at": now,
        "next_check_at": next_check_at,
        "last_result": result,
        "update_available": update_available,
    }
    previous_sha = previous.get("current_remote_sha") if state_matches(previous, source, ref) else None
    resolved_sha = current_remote_sha or previous_sha
    if resolved_sha:
        state["current_remote_sha"] = resolved_sha
    previous_digest = previous.get("local_digest") if state_matches(previous, source, ref) else None
    resolved_digest = local_digest or previous_digest
    if resolved_digest:
        state["local_digest"] = resolved_digest
    return state


def retry_interval_hours() -> float:
    raw = os.environ.get(RETRY_INTERVAL_ENV, str(DEFAULT_RETRY_INTERVAL_HOURS))
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{RETRY_INTERVAL_ENV} must be a non-negative number") from exc
    if value < 0:
        raise RuntimeError(f"{RETRY_INTERVAL_ENV} must be a non-negative number")
    return value


def iter_files(root: Path):
    for file_path in sorted(root.rglob("*")):
        relative = file_path.relative_to(root)
        if any(part in IGNORE_NAMES for part in relative.parts):
            continue
        if file_path.is_file():
            yield file_path, relative


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for file_path, relative in iter_files(root):
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def is_git_checkout(directory: Path) -> bool:
    current = directory.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return True
    return False


def fetch_remote_revision(owner: str, repo: str, ref: str, remote_skill: str, timeout: int) -> str:
    query = urllib.parse.urlencode({
        "sha": ref,
        "path": f"skills/{remote_skill}",
        "per_page": 1,
    })
    url = f"https://api.github.com/repos/{owner}/{repo}/commits?{query}"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": f"{SKILL_NAME}-self-updater",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (OSError, ValueError, urllib.error.URLError) as exc:
        raise RuntimeError(f"revision check failed: {exc}") from exc
    if not isinstance(payload, list) or not payload:
        raise RuntimeError("revision check returned no commits for the Skill path")
    revision = payload[0].get("sha") if isinstance(payload[0], dict) else None
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", revision):
        raise RuntimeError("revision check returned an invalid commit SHA")
    return revision.lower()


def download_archive(owner: str, repo: str, ref: str, workdir: Path, timeout: int) -> Path:
    safe_ref = urllib.parse.quote(ref, safe="")
    url = f"https://codeload.github.com/{owner}/{repo}/zip/{safe_ref}"
    archive_path = workdir / "repository.zip"
    request = urllib.request.Request(url, headers={"User-Agent": f"{SKILL_NAME}-self-updater"})
    downloaded = 0
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response, archive_path.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError("download exceeded the 100 MiB safety limit")
                output.write(chunk)
    except (OSError, urllib.error.URLError) as exc:
        raise RuntimeError(f"download failed: {exc}") from exc
    return archive_path


def safe_extract(archive: zipfile.ZipFile, destination: Path) -> Path:
    destination_root = destination.resolve()
    top_levels: set[str] = set()
    extracted_bytes = 0
    for info in archive.infolist():
        if not info.filename:
            continue
        target = (destination / info.filename).resolve()
        if target != destination_root and not str(target).startswith(str(destination_root) + os.sep):
            raise RuntimeError("archive contains an unsafe path")
        mode = info.external_attr >> 16
        if stat.S_ISLNK(mode):
            raise RuntimeError("archive contains a symbolic link")
        extracted_bytes += info.file_size
        if extracted_bytes > MAX_EXTRACTED_BYTES:
            raise RuntimeError("archive exceeded the 250 MiB extraction safety limit")
        top_levels.add(info.filename.split("/", 1)[0])
    if len(top_levels) != 1:
        raise RuntimeError("unexpected GitHub archive layout")
    archive.extractall(destination)
    return destination / next(iter(top_levels))


def validate_remote_skill(source: Path, expected_name: str) -> None:
    skill_file = source / "SKILL.md"
    if not skill_file.is_file():
        raise RuntimeError(f"remote skill is missing SKILL.md: {source}")
    prefix = skill_file.read_text(encoding="utf-8")[:4096]
    if not re.search(rf"(?m)^name:\s*{re.escape(expected_name)}\s*$", prefix):
        raise RuntimeError(f"remote SKILL.md does not declare name: {expected_name}")


def copy_preserved_files(current: Path, staging: Path) -> None:
    for name in PRESERVE_NAMES:
        source = current / name
        target = staging / name
        if not source.exists() or target.exists():
            continue
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)


def atomic_install(source: Path, destination: Path) -> None:
    parent = destination.parent
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.update-", dir=parent))
    backup = Path(tempfile.mkdtemp(prefix=f".{destination.name}.backup-", dir=parent))
    backup.rmdir()
    moved_current = False
    try:
        shutil.copytree(source, staging, dirs_exist_ok=True)
        copy_preserved_files(destination, staging)
        os.replace(destination, backup)
        moved_current = True
        try:
            os.replace(staging, destination)
        except Exception:
            os.replace(backup, destination)
            moved_current = False
            raise
        shutil.rmtree(backup, ignore_errors=True)
        moved_current = False
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        if moved_current and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        elif backup.exists():
            shutil.rmtree(backup, ignore_errors=True)


@contextmanager
def update_lock(destination: Path):
    lock = destination.parent / f".{destination.name}.update.lock"
    try:
        lock.mkdir()
    except FileExistsError:
        age = time.time() - lock.stat().st_mtime
        if age <= LOCK_STALE_SECONDS:
            raise RuntimeError("已有更新检查正在运行")
        shutil.rmtree(lock, ignore_errors=True)
        lock.mkdir()
    try:
        yield
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def update_error_zh(exc: Exception) -> str:
    message = str(exc)
    translations = {
        "offline": "网络不可用，请恢复网络后重试",
        "another update check is already running": "已有更新检查正在运行",
        "source must use owner/repo@skill with safe GitHub path characters": "更新来源格式无效，应使用 owner/repo@skill",
        "revision check returned no commits for the Skill path": "远端未找到此 skill 路径的提交",
        "revision check returned an invalid commit SHA": "远端返回的提交标识无效",
        "download exceeded the 100 MiB safety limit": "下载超过 100 MiB 限制",
        "archive contains an unsafe path": "压缩包包含不安全路径",
        "archive contains a symbolic link": "压缩包包含符号链接",
        "archive exceeded the 250 MiB extraction safety limit": "解压超过 250 MiB 限制",
        "unexpected GitHub archive layout": "远端压缩包目录结构不符合预期",
    }
    if message in translations:
        return translations[message]
    if any(token in message.lower() for token in ("timeout", "timed out", "download failed", "revision check failed", "offline")):
        return "远端查询或下载失败，请检查网络、来源地址及访问权限"
    if any("\u4e00" <= char <= "\u9fff" for char in message):
        return message
    return f"更新条件不满足（{type(exc).__name__}），请检查来源配置、目标目录权限和远端文件完整性"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    automatic_disabled = os.environ.get(AUTO_UPDATE_ENV, "1").strip().lower() in {"0", "false", "no", "off"}
    if automatic_disabled and not args.force and not args.check_only:
        print(f"{SKILL_NAME} 本次已禁用更新。", file=sys.stderr)
        return 0

    destination = Path(args.dest).expanduser().resolve()
    if not destination.is_dir():
        print(f"{SKILL_NAME} 更新失败：目标目录不存在： {destination}", file=sys.stderr)
        return 1
    if is_git_checkout(destination) and not args.allow_git_checkout:
        print(f"{SKILL_NAME} 目标位于 Git 工作区，已跳过替换。", file=sys.stderr)
        return 0
    if args.interval_hours < 0:
        print(f"{SKILL_NAME} 更新失败：--interval-hours 必须为非负数", file=sys.stderr)
        return 1

    try:
        owner, repo, remote_skill = parse_source(args.source)
        if remote_skill != SKILL_NAME:
            raise RuntimeError(f"source skill must be {SKILL_NAME}, got {remote_skill}")
        now = time.time()
        state = load_update_state(destination)
        if not args.force and not args.check_only and cache_is_fresh(state, args.source, args.ref, now):
            print(f"{project_tracking_integrator_cached_message(state)}", file=sys.stderr)
            return 0
        with update_lock(destination):
            state = load_update_state(destination)
            now = time.time()
            if not args.force and not args.check_only and cache_is_fresh(state, args.source, args.ref, now):
                print(f"{project_tracking_integrator_cached_message(state)}", file=sys.stderr)
                return 0
            remote_revision = fetch_remote_revision(owner, repo, args.ref, remote_skill, args.timeout)
            current_revision = state.get("current_remote_sha") if state_matches(state, args.source, args.ref) else None
            recorded_digest = state.get("local_digest") if state_matches(state, args.source, args.ref) else None
            current_digest = tree_digest(destination)
            next_check_at = now + args.interval_hours * 3600
            if current_revision == remote_revision and recorded_digest == current_digest:
                write_update_state(destination, build_update_state(
                    state,
                    source=args.source,
                    ref=args.ref,
                    now=now,
                    next_check_at=next_check_at,
                    result="current",
                    current_remote_sha=remote_revision,
                    local_digest=current_digest,
                ))
                print(f"{SKILL_NAME} 已经是最新版本。", file=sys.stderr)
                return 0
            if args.check_only and current_revision:
                write_update_state(destination, build_update_state(
                    state,
                    source=args.source,
                    ref=args.ref,
                    now=now,
                    next_check_at=now,
                    result="update-available",
                    update_available=True,
                ))
                print(f"{SKILL_NAME} 发现可用更新。", file=sys.stderr)
                return 2
            with tempfile.TemporaryDirectory(prefix=f"{SKILL_NAME}-update-") as temporary:
                workdir = Path(temporary)
                archive_path = download_archive(owner, repo, args.ref, workdir, args.timeout)
                with zipfile.ZipFile(archive_path, "r") as archive:
                    repository_root = safe_extract(archive, workdir / "extracted")
                source = repository_root / "skills" / remote_skill
                validate_remote_skill(source, remote_skill)
                if tree_digest(source) == tree_digest(destination):
                    current_digest = tree_digest(destination)
                    write_update_state(destination, build_update_state(
                        state,
                        source=args.source,
                        ref=args.ref,
                        now=now,
                        next_check_at=next_check_at,
                        result="current",
                        current_remote_sha=remote_revision,
                        local_digest=current_digest,
                    ))
                    print(f"{SKILL_NAME} 已经是最新版本。", file=sys.stderr)
                    return 0
                if args.check_only:
                    write_update_state(destination, build_update_state(
                        state,
                        source=args.source,
                        ref=args.ref,
                        now=now,
                        next_check_at=now,
                        result="update-available",
                        update_available=True,
                    ))
                    print(f"{SKILL_NAME} 发现可用更新。", file=sys.stderr)
                    return 2
                atomic_install(source, destination)
                installed_digest = tree_digest(destination)
                write_update_state(destination, build_update_state(
                    {},
                    source=args.source,
                    ref=args.ref,
                    now=now,
                    next_check_at=next_check_at,
                    result="updated",
                    current_remote_sha=remote_revision,
                    local_digest=installed_digest,
                ))
                print(
                    f"{SKILL_NAME} 已安装最新文件，来源："
                    f"{owner}/{repo}@{args.ref} (skills/{remote_skill}).",
                    file=sys.stderr,
                )
                return 2
    except Exception as exc:
        try:
            now = time.time()
            state = load_update_state(destination)
            write_update_state(destination, build_update_state(
                state,
                source=args.source,
                ref=args.ref,
                now=now,
                next_check_at=now + retry_interval_hours() * 3600,
                result="error",
                update_available=state.get("update_available") is True,
            ))
        except Exception:
            pass
        print(f"{SKILL_NAME} 更新失败：{update_error_zh(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
