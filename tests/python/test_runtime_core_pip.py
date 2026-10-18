from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import venv
import zipfile
from pathlib import Path
from unittest import mock

import worker_bootstrap as worker


class OfflineCoreUpdateTests(unittest.TestCase):
    def test_real_resolver_installs_the_confirmed_pair_and_dependency_then_restores_the_base(self):
        self.run_offline_update(bundled=False)

    def test_read_only_bundled_runtime_updates_and_rolls_back_through_user_overlays(self):
        self.run_offline_update(bundled=True)

    def run_offline_update(self, *, bundled):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        envs = root / "runtime-envs"
        envs.mkdir()
        bundled_envs = root / "Installed.app/Contents/Resources/python-runtime/runtime-envs"
        base = (bundled_envs if bundled else envs) / "cpu"
        venv.EnvBuilder(with_pip=True).create(base)
        python = base / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        wheels = root / "wheels"
        wheels.mkdir()

        def wheel(name, version, requirements=()):
            package = name.replace("-", "_")
            info = f"{package}-{version}.dist-info"
            code = (
                "__version__='2.7.1'\nfrom types import SimpleNamespace\n"
                "version=SimpleNamespace(cuda=None,hip=None)\n"
                "cuda=SimpleNamespace(is_available=lambda:False)\n"
            ) if name == "torch" else ""
            entries = {
                f"{package}/__init__.py": code,
                f"{info}/METADATA": f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\nProvides-Extra: proxy\n"
                + "".join(f"Requires-Dist: {requirement}\n" for requirement in requirements),
                f"{info}/WHEEL": "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
            }
            if name == "pymss":
                entries["pymss/graph/__init__.py"] = ""
            record = io.StringIO()
            csv.writer(record).writerows((path, "", "") for path in [*entries, f"{info}/RECORD"])
            entries[f"{info}/RECORD"] = record.getvalue()
            with zipfile.ZipFile(wheels / f"{package}-{version}-py3-none-any.whl", "w") as archive:
                for path, content in entries.items():
                    archive.writestr(path, content)

        wheel("torch", "2.7.1")
        wheel("pymss", "2.1.4", ["pymss-core==0.1.6", "torch>=2"])
        wheel("pymss-core", "0.1.6", ["torch>=2"])
        wheel("pymss", "2.2.0", ["pymss-core>=0.1.7,<0.2", "new-audio-dependency>=1", "torch>=2"])
        wheel("pymss-core", "0.1.7", ["torch>=2"])
        wheel("pymss-core", "0.2.0", ["torch>=2"])
        wheel("new-audio-dependency", "1.0")
        child_env = os.environ.copy()
        child_env.pop("PYTHONHOME", None)
        child_env.pop("PYTHONPATH", None)
        seed = subprocess.run([
            str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-index", "--find-links", str(wheels),
            "pymss==2.1.4", "pymss-core==0.1.6", "torch==2.7.1",
        ], env=child_env, capture_output=True, text=True, timeout=90)
        self.assertEqual(seed.returncode, 0, seed.stderr)
        manifest = {
            "manifestVersion": "2026.10.2", "baseGeneration": 1,
            "python": f"{sys.version_info.major}.{sys.version_info.minor}",
            "common": {"pymss": "pymss[proxy]==2.1.4", "pymss-core": "pymss-core==0.1.6"},
            "backends": {"cpu": {"platforms": [sys.platform], "torch": {"requirement": "torch==2.7.1"}}},
        }
        state = {
            "source": "bundled" if bundled else "managed",
            "backend": "cpu", "manifestVersion": manifest["manifestVersion"], "stateVersion": worker.ENV_STATE_VERSION,
            "pythonPath": str(python), "torchVersion": "2.7.1", "torchBackend": "cpu",
            "packages": {"pymss": True, "pymss-core": True},
            "packageVersions": {"pymss": "2.1.4", "pymss-core": "0.1.6"},
            "pymssVersion": "2.1.4", "pymssCoreVersion": "0.1.6", "pymssGraphAvailable": True,
        }
        active = envs / "active-runtime.json"
        cached = base / "pymss-runtime-state.json"
        active.write_text(json.dumps(state), encoding="utf-8")
        cached.write_text(json.dumps(state), encoding="utf-8")
        baseline = {
            path.relative_to(base).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in base.rglob("*") if path.is_file()
        }
        if bundled:
            paths = [base, *base.rglob("*")]
            modes = [(path, path.stat().st_mode) for path in paths if not path.is_symlink()]

            def restore_permissions():
                for path, mode in modes:
                    path.chmod(mode)

            self.addCleanup(restore_permissions)
            for path, mode in reversed(modes):
                path.chmod(mode & ~0o222)
        real_popen = subprocess.Popen
        installs = []

        def offline_popen(command, *args, **kwargs):
            if "pip" in command and "install" in command:
                command = [*command, "--disable-pip-version-check", "--no-index", "--find-links", str(wheels)]
                installs.append(command)
            return real_popen(command, *args, **kwargs)

        with mock.patch.object(worker, "RUNTIME_ENVS_DIR", envs), \
             mock.patch.object(worker, "ACTIVE_RUNTIME_FILE", active), \
             mock.patch.object(worker, "BUNDLED_RUNTIME_ENVS_DIR", bundled_envs if bundled else None), \
             mock.patch.object(worker, "_manifest", return_value=manifest), \
             mock.patch.object(worker, "_latest_pypi_version", side_effect=lambda name, channel="stable": {"pymss": "2.2.0", "pymss-core": "0.2.0"}[name]) as latest, \
             mock.patch.object(worker, "_verify_runtime_audio"), \
             mock.patch.object(worker.subprocess, "Popen", side_effect=offline_popen), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            payload = {"backend": "cpu", "pythonPath": str(python), "mirror": "pypi", "mode": "update", "taskId": "offline-pip"}
            self.assertEqual(worker.cmd_update_runtime_core({**payload, "prepareOnly": True}), 0, output.getvalue())
            plan = next(json.loads(line)["payload"] for line in output.getvalue().splitlines() if json.loads(line)["type"] == "runtime_core_update_plan")
            self.assertEqual(plan["targetVersions"], {"pymss": "2.2.0", "pymss-core": "0.1.7"})
            self.assertEqual(json.loads(active.read_text(encoding="utf-8"))["pymssVersion"], "2.1.4")
            latest.side_effect = AssertionError("Confirmed installation must not query upstream")
            self.assertEqual(worker.cmd_update_runtime_core({**payload, "planId": plan["id"]}), 0, output.getvalue())
            installed = json.loads(active.read_text(encoding="utf-8"))
            self.assertEqual(installed["pymssCoreVersion"], "0.1.7")
            self.assertTrue((Path(installed["overlayPath"]) / "new_audio_dependency").is_dir())
            loaded = subprocess.run(
                [str(python), "-c", "import pymss, new_audio_dependency; print(pymss.__file__)"],
                env=worker._probe_environment(Path(installed["overlayPath"]), python_path=python),
                capture_output=True, text=True, timeout=30, check=True,
            )
            self.assertTrue(Path(loaded.stdout.strip()).is_relative_to(Path(installed["overlayPath"])))
            self.assertEqual(worker.cmd_update_runtime_core({**payload, "mode": "rollback", "prepareOnly": True}), 0, output.getvalue())
            plans = [json.loads(line)["payload"] for line in output.getvalue().splitlines() if json.loads(line)["type"] == "runtime_core_update_plan"]
            self.assertEqual(worker.cmd_update_runtime_core({**payload, "planId": plans[-1]["id"]}), 0, output.getvalue())
            restored = json.loads(active.read_text(encoding="utf-8"))
            self.assertEqual(restored["pymssVersion"], "2.1.4")
            self.assertFalse(restored.get("overlayPath"))
            self.assertEqual(json.loads(cached.read_text(encoding="utf-8"))["pymssVersion"], "2.1.4")
            loaded = subprocess.run(
                [str(python), "-c", "import pymss; print(pymss.__file__)"],
                env=worker._probe_environment(python_path=python),
                capture_output=True, text=True, timeout=30, check=True,
            )
            self.assertTrue(Path(loaded.stdout.strip()).is_relative_to(base))
        self.assertEqual(len(installs), 2)
        if bundled:
            after = {
                path.relative_to(base).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in base.rglob("*") if path.is_file()
            }
            self.assertEqual(after, baseline, "The immutable bundled runtime must not change")
