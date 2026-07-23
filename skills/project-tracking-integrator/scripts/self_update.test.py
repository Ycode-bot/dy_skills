from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
import zipfile


MODULE_PATH = Path(__file__).with_name("self_update.py")
SPEC = importlib.util.spec_from_file_location("project_tracking_self_update", MODULE_PATH)
assert SPEC and SPEC.loader
UPDATER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATER)


class SelfUpdateTests(unittest.TestCase):
    def test_parse_source(self):
        self.assertEqual(
            UPDATER.parse_source("Ycode-bot/dy_skills@project-tracking-integrator"),
            ("Ycode-bot", "dy_skills", "project-tracking-integrator"),
        )
        with self.assertRaises(ValueError):
            UPDATER.parse_source("https://github.com/Ycode-bot/dy_skills")

    def test_tree_digest_ignores_preserved_runtime_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "SKILL.md").write_text("one", encoding="utf-8")
            first = UPDATER.tree_digest(root)
            (root / ".DS_Store").write_text("local", encoding="utf-8")
            (root / "node_modules").mkdir()
            (root / "node_modules" / "cache").write_text("local", encoding="utf-8")
            self.assertEqual(first, UPDATER.tree_digest(root))

    def test_safe_extract_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "unsafe.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("repo/../../outside", "bad")
            with zipfile.ZipFile(archive_path, "r") as archive:
                with self.assertRaises(RuntimeError):
                    UPDATER.safe_extract(archive, root / "output")

    def test_atomic_install_replaces_skill_and_preserves_runtime_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "remote"
            destination = root / "installed"
            source.mkdir()
            destination.mkdir()
            (source / "SKILL.md").write_text("new", encoding="utf-8")
            (source / "scripts").mkdir()
            (source / "scripts" / "tool.py").write_text("new", encoding="utf-8")
            (destination / "SKILL.md").write_text("old", encoding="utf-8")
            (destination / "obsolete.txt").write_text("remove", encoding="utf-8")
            (destination / "node_modules").mkdir()
            (destination / "node_modules" / "cache").write_text("keep", encoding="utf-8")

            UPDATER.atomic_install(source, destination)

            self.assertEqual((destination / "SKILL.md").read_text(encoding="utf-8"), "new")
            self.assertFalse((destination / "obsolete.txt").exists())
            self.assertEqual((destination / "node_modules" / "cache").read_text(encoding="utf-8"), "keep")

    def test_git_checkout_detection_walks_parent_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".git").mkdir()
            nested = root / "skills" / "project-tracking-integrator"
            nested.mkdir(parents=True)
            self.assertTrue(UPDATER.is_git_checkout(nested))

    def test_update_state_round_trip_and_ttl(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)
            state = UPDATER.build_update_state(
                {},
                source=UPDATER.DEFAULT_SOURCE,
                ref=UPDATER.DEFAULT_REF,
                now=100,
                next_check_at=200,
                result="current",
                current_remote_sha="a" * 40,
            )
            UPDATER.write_update_state(destination, state)
            loaded = UPDATER.load_update_state(destination)

            self.assertEqual(loaded["current_remote_sha"], "a" * 40)
            self.assertTrue(UPDATER.cache_is_fresh(loaded, UPDATER.DEFAULT_SOURCE, UPDATER.DEFAULT_REF, 150))
            self.assertFalse(UPDATER.cache_is_fresh(loaded, UPDATER.DEFAULT_SOURCE, UPDATER.DEFAULT_REF, 201))

    def test_main_uses_fresh_cache_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "installed"
            destination.mkdir()
            (destination / "SKILL.md").write_text(
                "---\nname: project-tracking-integrator\n---\ncurrent\n",
                encoding="utf-8",
            )
            now = time.time()
            UPDATER.write_update_state(destination, UPDATER.build_update_state(
                {},
                source=UPDATER.DEFAULT_SOURCE,
                ref=UPDATER.DEFAULT_REF,
                now=now,
                next_check_at=now + 3600,
                result="current",
                current_remote_sha="a" * 40,
            ))
            original_revision = UPDATER.fetch_remote_revision
            UPDATER.fetch_remote_revision = lambda *_args, **_kwargs: self.fail("network should not be used")
            try:
                result = UPDATER.main(["--dest", str(destination)])
            finally:
                UPDATER.fetch_remote_revision = original_revision

            self.assertEqual(result, 0)

    def test_force_bypasses_fresh_cache_but_avoids_download_when_revision_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "installed"
            destination.mkdir()
            (destination / "SKILL.md").write_text(
                "---\nname: project-tracking-integrator\n---\ncurrent\n",
                encoding="utf-8",
            )
            revision = "b" * 40
            now = time.time()
            UPDATER.write_update_state(destination, UPDATER.build_update_state(
                {},
                source=UPDATER.DEFAULT_SOURCE,
                ref=UPDATER.DEFAULT_REF,
                now=now,
                next_check_at=now + 3600,
                result="current",
                current_remote_sha=revision,
                local_digest=UPDATER.tree_digest(destination),
            ))
            revision_calls = 0
            original_revision = UPDATER.fetch_remote_revision
            original_download = UPDATER.download_archive

            def fetch_revision(*_args, **_kwargs):
                nonlocal revision_calls
                revision_calls += 1
                return revision

            UPDATER.fetch_remote_revision = fetch_revision
            UPDATER.download_archive = lambda *_args, **_kwargs: self.fail("archive should not be downloaded")
            previous_auto_update = os.environ.get(UPDATER.AUTO_UPDATE_ENV)
            os.environ[UPDATER.AUTO_UPDATE_ENV] = "0"
            try:
                result = UPDATER.main(["--dest", str(destination), "--force"])
            finally:
                UPDATER.fetch_remote_revision = original_revision
                UPDATER.download_archive = original_download
                if previous_auto_update is None:
                    os.environ.pop(UPDATER.AUTO_UPDATE_ENV, None)
                else:
                    os.environ[UPDATER.AUTO_UPDATE_ENV] = previous_auto_update

            self.assertEqual(result, 0)
            self.assertEqual(revision_calls, 1)

    def test_force_repairs_local_drift_when_remote_revision_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "installed"
            destination.mkdir()
            skill_file = destination / "SKILL.md"
            skill_file.write_text(
                "---\nname: project-tracking-integrator\n---\noriginal\n",
                encoding="utf-8",
            )
            revision = "d" * 40
            now = time.time()
            UPDATER.write_update_state(destination, UPDATER.build_update_state(
                {},
                source=UPDATER.DEFAULT_SOURCE,
                ref=UPDATER.DEFAULT_REF,
                now=now,
                next_check_at=now + 3600,
                result="current",
                current_remote_sha=revision,
                local_digest=UPDATER.tree_digest(destination),
            ))
            skill_file.write_text(
                "---\nname: project-tracking-integrator\n---\ncorrupted\n",
                encoding="utf-8",
            )
            archive_path = root / "remote.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr(
                    "dy_skills-main/skills/project-tracking-integrator/SKILL.md",
                    "---\nname: project-tracking-integrator\n---\noriginal\n",
                )

            original_download = UPDATER.download_archive
            original_revision = UPDATER.fetch_remote_revision
            UPDATER.download_archive = lambda *_args, **_kwargs: archive_path
            UPDATER.fetch_remote_revision = lambda *_args, **_kwargs: revision
            try:
                result = UPDATER.main(["--dest", str(destination), "--force"])
            finally:
                UPDATER.download_archive = original_download
                UPDATER.fetch_remote_revision = original_revision

            self.assertEqual(result, 2)
            self.assertIn("original", skill_file.read_text(encoding="utf-8"))
            state = UPDATER.load_update_state(destination)
            self.assertEqual(state["local_digest"], UPDATER.tree_digest(destination))

    def test_failed_check_is_cached_for_retry_interval(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "installed"
            destination.mkdir()
            (destination / "SKILL.md").write_text(
                "---\nname: project-tracking-integrator\n---\ncurrent\n",
                encoding="utf-8",
            )
            original_revision = UPDATER.fetch_remote_revision
            UPDATER.fetch_remote_revision = lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("offline"))
            try:
                result = UPDATER.main(["--dest", str(destination), "--force"])
            finally:
                UPDATER.fetch_remote_revision = original_revision

            state = UPDATER.load_update_state(destination)
            self.assertEqual(result, 1)
            self.assertEqual(state["last_result"], "error")
            self.assertGreater(state["next_check_at"], time.time())
            self.assertTrue(UPDATER.cache_is_fresh(
                state,
                UPDATER.DEFAULT_SOURCE,
                UPDATER.DEFAULT_REF,
                time.time(),
            ))

    def test_main_installs_a_valid_remote_skill_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "installed"
            destination.mkdir()
            (destination / "SKILL.md").write_text(
                "---\nname: project-tracking-integrator\n---\nold\n",
                encoding="utf-8",
            )
            archive_path = root / "remote.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr(
                    "dy_skills-main/skills/project-tracking-integrator/SKILL.md",
                    "---\nname: project-tracking-integrator\n---\nnew\n",
                )
                archive.writestr(
                    "dy_skills-main/skills/project-tracking-integrator/scripts/tool.py",
                    "print('new')\n",
                )

            original_download = UPDATER.download_archive
            original_revision = UPDATER.fetch_remote_revision
            UPDATER.download_archive = lambda *_args, **_kwargs: archive_path
            UPDATER.fetch_remote_revision = lambda *_args, **_kwargs: "c" * 40
            try:
                result = UPDATER.main(["--dest", str(destination)])
            finally:
                UPDATER.download_archive = original_download
                UPDATER.fetch_remote_revision = original_revision

            self.assertEqual(result, 2)
            self.assertIn("new", (destination / "SKILL.md").read_text(encoding="utf-8"))
            self.assertTrue((destination / "scripts" / "tool.py").is_file())
            self.assertEqual(UPDATER.load_update_state(destination)["current_remote_sha"], "c" * 40)
            self.assertEqual(
                UPDATER.load_update_state(destination)["local_digest"],
                UPDATER.tree_digest(destination),
            )


if __name__ == "__main__":
    unittest.main()
