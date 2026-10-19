import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ.get("PYMSS_LINUX_SOURCE_ROOT", ROOT))
spec = importlib.util.spec_from_file_location("linux_release_compat", ROOT / "scripts/linux-release-compat.py")
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)


class ReleaseOverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ("src-tauri/build.rs", "src-tauri/src/commands/app_cmd.rs", "src/views/SettingsView.vue", "src/i18n/en.json", "src/i18n/zh-CN.json"):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / name, dest)

    def tearDown(self):
        self.temp.cleanup()

    def test_release_metadata_and_links_preserve_upstream_attribution(self):
        compat.apply(self.root, "0.0.21-7", "ChrisTorng/pymss-studio-linux")
        ui = (self.root / "src/views/SettingsView.vue").read_text(encoding="utf-8")
        self.assertIn("const repoUrl = 'https://github.com/pymss-project/pymss-studio'", ui)
        self.assertIn("https://github.com/ChrisTorng/pymss-studio-linux/releases/latest", ui)
        self.assertNotIn("repoUrl + '/releases/latest'", ui)
        rust = (self.root / "src-tauri/src/commands/app_cmd.rs").read_text(encoding="utf-8")
        self.assertIn('version: option_env!("PYMSS_BUILD_PACKAGE_VERSION")', rust)
        data = json.loads((self.root / "src-tauri/resources/linux-build-info.json").read_text())
        self.assertEqual(data["packageVersion"], "0.0.21-7")
        self.assertEqual(data["upstreamVersion"], "0.0.21")
        self.assertFalse(data["official"])
        self.assertFalse(data["updateSupported"])
        for locale in ("en", "zh-CN"):
            before = json.loads((SOURCE / f"src/i18n/{locale}.json").read_text(encoding="utf-8"))
            after = json.loads((self.root / f"src/i18n/{locale}.json").read_text(encoding="utf-8"))
            before["settings"]["updateUnsupportedHint"] = after["settings"]["updateUnsupportedHint"]
            self.assertEqual(before, after)

    def test_changed_upstream_anchor_requires_review(self):
        path = self.root / "src/views/SettingsView.vue"
        path.write_text("upstream changed", encoding="utf-8")
        with self.assertRaises(ValueError):
            compat.apply(self.root, "0.0.21-7", "ChrisTorng/pymss-studio-linux")

    def test_invalid_release_inputs_are_rejected(self):
        for version, repository in (("0.0.21-0", "owner/repo"), ("bad", "owner/repo"), ("0.0.21-7", "../repo")):
            with self.subTest(version=version, repository=repository):
                with self.assertRaises(ValueError):
                    compat.apply(self.root, version, repository)


if __name__ == "__main__":
    unittest.main()
