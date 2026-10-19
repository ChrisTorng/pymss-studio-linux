"""Exercise real symlinked venvs without downloading Torch or FunASR."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import venv


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("linux_optional_compat", ROOT / "scripts/linux-optional-packages-compat.py")
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)
SOURCE = (ROOT / "python/worker_optional_packages.py").read_text(encoding="utf-8")


class SymlinkedRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.worker = cls.root / "worker"
        cls.worker.mkdir()
        (cls.worker / "worker_optional_packages.py").write_text(compat.patch_source(SOURCE), encoding="utf-8")
        # Only the protocol transport is irrelevant to these runtime checks.
        (cls.worker / "worker_protocol.py").write_text("def emit(*a, **k): pass\ndef emit_error(*a, **k): pass\n")
        cls.environ = os.environ.copy()
        for key in ("PYTHONHOME", "PYTHONPATH", "PYMSS_STUDIO_RUNTIME_ENVS_DIR", "PYMSS_STUDIO_ACTIVE_RUNTIME_FILE"):
            cls.environ.pop(key, None)
        cls.environ["PYTHONDONTWRITEBYTECODE"] = "1"
        cls.pythons = []
        for backend in ("cuda", "cpu"):
            directory = cls.root / "runtime-envs" / backend
            venv.EnvBuilder(with_pip=False, symlinks=True).create(directory)
            python = directory / "bin/python"
            assert python.is_symlink(), "Test must exercise a symlinked Linux venv"
            cls.pythons.append(python)
            purelib = Path(subprocess.check_output([str(python), "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"], text=True, env=cls.environ).strip())
            for name in ("torch", "torchaudio"):
                metadata = purelib / f"{name}-2.7.1+cu128.dist-info"
                metadata.mkdir()
                (metadata / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: 2.7.1+cu128\n")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def probe(self, python, code):
        return json.loads(subprocess.check_output([str(python), "-c", "import json, sys; import worker_optional_packages as w; " + code], cwd=self.worker, text=True, env=self.environ))

    def test_context_preserves_venv_and_default_sidecar_root(self):
        for python in self.pythons:
            with self.subTest(python=str(python)):
                result = self.probe(python, "r=w._runtime_context(); print(json.dumps([str(r.executable), str(r.packages_dir), sys.prefix]))")
                self.assertEqual(result[0], str(python))
                self.assertEqual(Path(result[1]).parent.parent, self.root / "runtime-envs")
                self.assertEqual(result[2], str(python.parent.parent))

    def test_metadata_probe_and_torchaudio_use_selected_runtime(self):
        result = self.probe(self.pythons[0], "print(json.dumps([w._environment_version('torch'), w._torchaudio_requirement()]))")
        self.assertEqual(result, ["2.7.1+cu128", None])

    def test_fallback_identity_distinguishes_sibling_venvs(self):
        identities = [self.probe(python, "print(json.dumps(w._runtime_identity()))") for python in self.pythons]
        self.assertNotEqual(*identities)

    def test_upstream_changes_require_review(self):
        with self.assertRaises(ValueError):
            compat.patch_source(compat.patch_source(SOURCE))


if __name__ == "__main__":
    unittest.main()
