"""Apply guarded Linux release metadata overlays in a transient build workspace."""

import json
import os
from pathlib import Path
import re
import sys


def replace_exact(path: Path, old: str, new: str, count: int = 1) -> None:
    source = path.read_text(encoding="utf-8")
    if source.count(old) != count:
        raise ValueError(f"Review Linux release overlay: upstream changed {path.name}")
    path.write_text(source.replace(old, new), encoding="utf-8")


def apply(root: Path, package_version: str, repository: str) -> None:
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[1-9]\d*)?", package_version):
        raise ValueError("Expected upstream version with optional positive Debian revision")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) or any(part in {".", ".."} for part in repository.split("/")):
        raise ValueError("Expected owner/repository")
    replace_exact(
        root / "src-tauri/build.rs",
        '        "PYMSS_BUILD_GIT_COMMIT",',
        '        "PYMSS_BUILD_PACKAGE_VERSION",\n        "PYMSS_BUILD_GIT_COMMIT",',
    )
    replace_exact(
        root / "src-tauri/src/commands/app_cmd.rs",
        '        version: env!("CARGO_PKG_VERSION"),',
        '        version: option_env!("PYMSS_BUILD_PACKAGE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION")),',
    )
    settings = root / "src/views/SettingsView.vue"
    replace_exact(
        settings,
        "const repoUrl = 'https://github.com/pymss-project/pymss-studio'",
        "const repoUrl = 'https://github.com/pymss-project/pymss-studio'\n"
        + f"const linuxReleaseUrl = 'https://github.com/{repository}/releases/latest'",
    )
    replace_exact(settings, "repoUrl + '/releases/latest'", "linuxReleaseUrl", count=2)
    hints = {
        "en": "Linux DEB updates are installed manually. Download the latest Linux package from this fork's Releases, then install it with the included installer.",
        "zh-CN": "Linux DEB 需要手动更新。请从此分支仓库的 Releases 下载最新 Linux 软件包，再使用随附的安装脚本安装。",
    }
    for locale, hint in hints.items():
        path = root / f"src/i18n/{locale}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["settings"]["updateUnsupportedHint"] = hint
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    metadata = {
        "packageVersion": package_version,
        "upstreamVersion": package_version.partition("-")[0],
        "repository": repository,
        "releaseUrl": f"https://github.com/{repository}/releases/latest",
        "gitCommit": os.environ.get("PYMSS_BUILD_GIT_COMMIT", ""),
        "gitTag": os.environ.get("PYMSS_BUILD_GIT_TAG", ""),
        "gitRef": os.environ.get("PYMSS_BUILD_GIT_REF", ""),
        "runId": os.environ.get("PYMSS_BUILD_RUN_ID", ""),
        "runAttempt": os.environ.get("PYMSS_BUILD_RUN_ATTEMPT", ""),
        "buildTime": os.environ.get("PYMSS_BUILD_TIME", ""),
        "target": "linux-amd64",
        "variant": "linux-amd64-online",
        "official": False,
        "updateSupported": False,
    }
    output = root / "src-tauri/resources/linux-build-info.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Applied Linux release overlay: {package_version}, {repository}")


if __name__ == "__main__":
    apply(Path(sys.argv[1]), sys.argv[2], sys.argv[3])
