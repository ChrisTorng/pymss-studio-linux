# Linux builds — Pymss Studio

This is an **unofficial, packaging-only** fork of [pymss-project/pymss-studio](https://github.com/pymss-project/pymss-studio). The program, model compatibility, and user interface come from upstream. This fork adds an Ubuntu `.deb` packaging workflow; it is not a new product or an upstream-supported Linux release.

## Supported systems and package strategy

- Architecture: **x86_64 / amd64** only. ARM64, other CPU architectures, Flatpak, RPM, and AppImage are not built here.
- The package is **built on Ubuntu 22.04**, the oldest supported target for Tauri 2 / WebKitGTK 4.1. One older-baseline build is generally preferable to three distro-specific builds because older glibc requirements can run on newer Ubuntu releases.
- CI checks package **installation and bundled Python on Ubuntu 22.04, 24.04, and 26.04**. This is *not* a guarantee that all UI, media features, GPU drivers or separation models have been exercised on those systems. Real desktop/GPU testing is still required.
- This is the **online/bootstrap** flavor: a portable Python 3.12 interpreter plus bootstrap dependencies are bundled, but heavy PyTorch/CPU/CUDA inference environments and models are downloaded and configured on first run. The distribution's Python version is not used as a substitute for 3.12.
- The `.deb` depends on standard Linux packages including WebKitGTK 4.1, GTK 3, FFmpeg, and aria2. They are resolved by `apt` on your system. It does **not** bundle CUDA or an NVIDIA driver.

## Download / build in GitHub Actions

1. Open [**Actions → Build Linux DEB**](https://github.com/ChrisTorng/pymss-studio-linux/actions/workflows/release-linux.yml) and choose **Run workflow** on `main`.
2. Leave the version override blank to derive the package version from the latest reachable upstream-style `vX.Y.Z` Git tag, or provide a specific `X.Y.Z` override when building a known release.
3. The build job creates **one** `.deb`. CI then attempts installation and bundled-Python smoke tests in three Ubuntu environments.
4. When the workflow completes, open the run and download the **`pymss-studio-linux-amd64`** artifact ZIP. Unzip it to get the `.deb` and `SHA256SUMS`. Do not treat a failed validation job as a verified release.

The workflow is **manual-only** (`workflow_dispatch`), so syncing upstream does not automatically rebuild Linux packages or create duplicate releases. Workflow artifacts expire according to the repository's GitHub Actions retention settings. They are not yet permanent GitHub Releases.

## Install on Ubuntu 26.04 (also 22.04 / 24.04)

Open a terminal in the directory holding the downloaded `.deb`:

```bash
sudo apt update
sudo apt install ./pymss-studio*.deb
```

Use `apt install ./...`, **not** `dpkg -i`, so system dependencies are resolved automatically.

Start **Pymss Studio** from your desktop application's launcher. On the first launch open **Settings → Runtime** (or finish onboarding) and install a supported CPU/CUDA inference environment, then download your required separation models. An Internet connection and free disk space are required for this step. For NVIDIA acceleration, install and validate the NVIDIA driver *on the host Ubuntu system*; this `.deb` does not include drivers.

To confirm which packages were installed:

```bash
dpkg -l | grep pymss-studio
dpkg -L pymss-studio | grep -E 'python-runtime|worker.py' | head
ffmpeg -version
aria2c --version
```

To remove the desktop package:

```bash
sudo apt remove pymss-studio
```

The user's application data, projects, downloaded models, and installed inference environments are generally under `~/.pymss-studio/` and are not intentionally removed by `apt remove`. Back them up before major upgrades. Avoid running the GUI as root.

## NVIDIA RTX 4090 / CUDA on Ubuntu 26.04

The single **online/bootstrap** DEB supports choosing the GPU runtime *after* installation. You do not need a separate Linux CUDA installer or a system-wide CUDA Toolkit merely to run the PyTorch CUDA wheel. The package itself contains **neither** PyTorch nor CUDA GPU libraries.

1. Install and verify a compatible NVIDIA driver on the Ubuntu host. Check `nvidia-smi`. The upstream runtime manifest currently requests **PyTorch 2.7.1 with CUDA 12.8 (cu128)**; compare your driver with the [NVIDIA CUDA 12.8 compatibility documentation](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-toolkit-release-notes/index.html).
2. Start Pymss Studio and choose **CUDA** during onboarding or in **Settings → Runtime → Install runtime**. Allow the program to download its CUDA-enabled PyTorch and inference packages into your home directory.
3. After the installation, verify from the Ubuntu terminal:

```bash
nvidia-smi
~/.pymss-studio/runtime-envs/cuda/bin/python -c 'import torch; print("torch:", torch.__version__, "CUDA:", torch.version.cuda); print("available:", torch.cuda.is_available()); print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "not available")'
```

For a working RTX 4090 setup the probe should report CUDA available and name the NVIDIA GPU. The `CUDA Version` field of `nvidia-smi` describes driver capability, not proof that a system-wide CUDA Toolkit is installed.

**Backend and distribution terminology:**

| Term | Meaning in this fork | Linux status |
| --- | --- | --- |
| **Online** | Small initial desktop package with bundled Python 3.12 bootstrap; install CPU/CUDA inference runtime separately through the UI | **Current Linux DEB strategy** |
| **CUDA** | Preinstalled NVIDIA-specific PyTorch inference environment in the release package | Not separately bundled; install through the UI after installing the online DEB |
| **CPU** | Preinstalled CPU-only PyTorch inference environment in the release package | Not separately bundled; CPU remains installable as another runtime |
| **ROCm** | AMD GPU inference environment; upstream Windows package is based on Windows-specific ROCm wheels | **Not supported by the current Studio Linux runtime manifest** |
| **Application update** | Update the installed Tauri desktop program | Linux: download/reinstall a newer DEB with `sudo apt install ./new-package.deb`; the official in-app auto-updater is Windows-only |
| **Runtime/core update** | Update or repair Python `pymss` / `pymss-core` dependencies within the managed inference environment | Conceptually supported on Linux; different from updating the desktop application |

**What CI does not prove:** GitHub-hosted standard Ubuntu runners do not expose your RTX 4090 and cannot verify CUDA GPU inference. The build pipeline only confirms that the package can be installed, its bundled Python is functional and the runtime manifest declares Linux/CUDA. Full validation needs a real Ubuntu machine with an NVIDIA driver and a model separation test.

## Compatibility and limitations

- **Ubuntu 26.04:** Ubuntu's standard Python may be 3.14, while upstream's runtime manifest requests 3.12. The bundled standalone Python solves the bootstrap version mismatch. Runtime/model installation and GPU compatibility still require testing.
- **Desktop session:** This is a native Tauri 2 / GTK / WebKitGTK app, not a web server. You need a graphical desktop; Docker is not the supported distribution mechanism here.
- **Audio tools:** FFmpeg/FFprobe and aria2 are provided through Ubuntu's package manager. If features cannot find them, check `command -v ffmpeg ffprobe aria2c`.
- **GPU acceleration:** Install a compatible driver and select the matching PyTorch runtime from the application. CUDA is not embedded in the initial DEB, and CUDA support on Ubuntu 26.04 is not yet independently validated by this fork.
- **File locations/permissions:** The packaged bootstrap under `/usr` is read-only for regular users; inference environments are installed into the user's home directory on Linux. This matters if an upstream change tries to write inside application resources.
- **Validation:** The CI installation matrix is an automated smoke check, *not* an end-to-end AI separation test. On hardware, verify launch, runtime download, one model load, audio import and export.
- **Upstream synchronization:** Use GitHub's **Sync fork**. Keep Linux-specific changes confined to this documentation, `.github/workflows/release-linux.yml`, and `scripts/prepare-linux-bundle.sh`. Do not rename the application's internal identifier or edit upstream Windows/macOS build scripts.

## Local source build (developers)

On Ubuntu, install [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/) plus Node.js 22, pnpm 10.33.2, Rust stable, and Python 3.12. For a normal developer build, see the [upstream README](https://github.com/pymss-project/pymss-studio#development-and-verification). The release workflow handles portable-Python staging; `pnpm tauri build --bundles deb` alone does **not** reproduce its runtime bundle.

The packaging workflow uses [python-build-standalone](https://github.com/astral-sh/python-build-standalone), following upstream's macOS approach but with a GNU/Linux interpreter.

## Workflow hygiene

Original `ci.yml`, `release.yml`, `release-windows.yml`, and `release-macos.yml` remain unchanged to minimize upstream merge conflicts. Disable these four **in this fork** using **Actions → select workflow → … → Disable workflow**. Keep **Build Linux DEB** enabled. The connected GitHub tools currently cannot change the GitHub-side enabled/disabled state.

To report issues with **Linux packaging**, open an issue on this fork; for **application functionality**, check upstream first.

## References

- [Upstream Pymss Studio](https://github.com/pymss-project/pymss-studio)
- [Tauri 2 Debian bundling](https://v2.tauri.app/distribute/debian/)
- [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
- [GitHub Actions runner images](https://github.com/actions/runner-images)
