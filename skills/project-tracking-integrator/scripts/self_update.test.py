from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
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
            UPDATER.download_archive = lambda *_args, **_kwargs: archive_path
            try:
                result = UPDATER.main(["--dest", str(destination)])
            finally:
                UPDATER.download_archive = original_download

            self.assertEqual(result, 2)
            self.assertIn("new", (destination / "SKILL.md").read_text(encoding="utf-8"))
            self.assertTrue((destination / "scripts" / "tool.py").is_file())


if __name__ == "__main__":
    unittest.main()
