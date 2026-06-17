#!/usr/bin/env python3
"""Update an installed skill directory from a GitHub repo path.

Exit codes:
  0: checked successfully, no update needed
  1: update failed
  2: updated files
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile


DEFAULT_REF = "main"
PRESERVE_NAMES = {".venv", ".DS_Store"}
IGNORE_NAMES = {".venv", ".DS_Store", "__pycache__"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Self-update activity-cms-psd from GitHub.")
    parser.add_argument("--repo", required=True, help="GitHub repo, e.g. Ycode-bot/dy_skills")
    parser.add_argument("--path", required=True, help="Skill path inside repo, e.g. skills/activity-cms-psd")
    parser.add_argument("--dest", required=True, help="Installed skill directory to update")
    parser.add_argument("--ref", default=DEFAULT_REF, help="Git ref to download")
    return parser.parse_args()


def iter_files(root: Path):
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if any(part in IGNORE_NAMES for part in rel.parts):
            continue
        if path.is_file():
            yield path, rel


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path, rel in iter_files(root):
        digest.update(str(rel).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def download_repo(owner: str, repo: str, ref: str, workdir: Path) -> Path:
    url = f"https://codeload.github.com/{owner}/{repo}/zip/{ref}"
    zip_path = workdir / "repo.zip"
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            zip_path.write_bytes(response.read())
    except urllib.error.URLError as exc:
        raise RuntimeError(f"download failed: {exc}") from exc

    with zipfile.ZipFile(zip_path, "r") as archive:
        safe_extract(archive, workdir)
        top_levels = {name.split("/")[0] for name in archive.namelist() if name}
    if len(top_levels) != 1:
        raise RuntimeError("unexpected GitHub zip layout")
    return workdir / next(iter(top_levels))


def safe_extract(archive: zipfile.ZipFile, dest: Path) -> None:
    dest_root = dest.resolve()
    for info in archive.infolist():
        target = (dest / info.filename).resolve()
        if target == dest_root or str(target).startswith(str(dest_root) + os.sep):
            continue
        raise RuntimeError("zip contains unsafe path")
    archive.extractall(dest)


def sync_tree(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)

    src_rel_paths = {
        path.relative_to(src)
        for path in src.rglob("*")
        if not any(part in IGNORE_NAMES for part in path.relative_to(src).parts)
    }

    for path in sorted(dest.rglob("*"), reverse=True):
        rel = path.relative_to(dest)
        if any(part in PRESERVE_NAMES for part in rel.parts):
            continue
        if rel in src_rel_paths:
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()

    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src)
        if any(part in IGNORE_NAMES for part in rel.parts):
            continue
        target = dest / rel
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def main() -> int:
    args = parse_args()
    repo_parts = args.repo.split("/", 1)
    if len(repo_parts) != 2:
        print("activity-cms-psd self-update: --repo must be owner/repo", file=sys.stderr)
        return 1

    owner, repo = repo_parts
    dest = Path(args.dest).expanduser().resolve()
    if not dest.exists():
        print(f"activity-cms-psd self-update: destination not found: {dest}", file=sys.stderr)
        return 1

    try:
        with tempfile.TemporaryDirectory(prefix="activity-cms-psd-update-") as tmp:
            repo_root = download_repo(owner, repo, args.ref, Path(tmp))
            src = repo_root / args.path
            if not (src / "SKILL.md").is_file():
                raise RuntimeError(f"skill path not found in repo: {args.path}")
            if tree_digest(src) == tree_digest(dest):
                print("activity-cms-psd is already up to date.", file=sys.stderr)
                return 0
            sync_tree(src, dest)
            print("activity-cms-psd installed the latest skill files.", file=sys.stderr)
            return 2
    except Exception as exc:
        print(f"activity-cms-psd self-update failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
