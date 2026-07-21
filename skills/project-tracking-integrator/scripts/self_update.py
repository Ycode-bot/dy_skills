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
PRESERVE_NAMES = {".DS_Store", ".update-state.json", ".venv", "node_modules"}
IGNORE_NAMES = PRESERVE_NAMES | {"__pycache__"}
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_EXTRACTED_BYTES = 250 * 1024 * 1024
LOCK_STALE_SECONDS = 120


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"Update {SKILL_NAME} from GitHub.")
    parser.add_argument(
        "--source",
        default=os.environ.get(SOURCE_ENV, DEFAULT_SOURCE),
        help="GitHub source in owner/repo@skill form",
    )
    parser.add_argument("--dest", required=True, help="Installed skill directory")
    parser.add_argument("--ref", default=os.environ.get(REF_ENV, DEFAULT_REF), help="Git ref")
    parser.add_argument("--timeout", type=int, default=20, help="Network timeout in seconds")
    parser.add_argument("--check-only", action="store_true", help="Report an update without installing it")
    parser.add_argument(
        "--allow-git-checkout",
        action="store_true",
        help="Allow replacing files inside a Git working tree",
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
            raise RuntimeError("another update check is already running")
        shutil.rmtree(lock, ignore_errors=True)
        lock.mkdir()
    try:
        yield
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if os.environ.get(AUTO_UPDATE_ENV, "1").strip().lower() in {"0", "false", "no", "off"}:
        print(f"{SKILL_NAME} auto-update is disabled for this run.", file=sys.stderr)
        return 0

    destination = Path(args.dest).expanduser().resolve()
    if not destination.is_dir():
        print(f"{SKILL_NAME} self-update failed: destination not found: {destination}", file=sys.stderr)
        return 1
    if is_git_checkout(destination) and not args.allow_git_checkout:
        print(f"{SKILL_NAME} auto-update skipped inside a Git working tree.", file=sys.stderr)
        return 0

    try:
        owner, repo, remote_skill = parse_source(args.source)
        if remote_skill != SKILL_NAME:
            raise RuntimeError(f"source skill must be {SKILL_NAME}, got {remote_skill}")
        with update_lock(destination):
            with tempfile.TemporaryDirectory(prefix=f"{SKILL_NAME}-update-") as temporary:
                workdir = Path(temporary)
                archive_path = download_archive(owner, repo, args.ref, workdir, args.timeout)
                with zipfile.ZipFile(archive_path, "r") as archive:
                    repository_root = safe_extract(archive, workdir / "extracted")
                source = repository_root / "skills" / remote_skill
                validate_remote_skill(source, remote_skill)
                if tree_digest(source) == tree_digest(destination):
                    print(f"{SKILL_NAME} is already up to date.", file=sys.stderr)
                    return 0
                if args.check_only:
                    print(f"{SKILL_NAME} update is available.", file=sys.stderr)
                    return 2
                atomic_install(source, destination)
                print(
                    f"{SKILL_NAME} installed the latest files from "
                    f"{owner}/{repo}@{args.ref} (skills/{remote_skill}).",
                    file=sys.stderr,
                )
                return 2
    except Exception as exc:
        print(f"{SKILL_NAME} self-update failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
