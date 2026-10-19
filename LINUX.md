# Linux builds — Pymss Studio

This is an **unofficial, packaging-only** fork of [pymss-project/pymss-studio](https://github.com/pymss-project/pymss-studio). The program, model compatibility, and user interface come from upstream. This fork adds an Ubuntu `.deb` packaging workflow; it is not a new product or an upstream-supported Linux release.

## Supported systems and package strategy

- Architecture: **x86_64 / amd64** only. ARM64, other CPU architectures, Flatpak, RPM, and AppImage are not built here.
- The package is **built on Ubuntu 22.04**, the oldest supported target for Tauri 2 / WebKitGTK 4.1. The app retains its upstream version (for example `0.0.21`); the DEB adds a Debian revision from the workflow's build number (for example `0.0.21-3`). A later Linux fix is then an APT upgrade even when upstream's app version is unchanged. A new upstream version takes precedence over any older Linux revision. One older-baseline build is generally preferable to three distro-specific builds because older glibc requirements can run on newer Ubuntu releases.
- CI checks package **installation and bundled Python on Ubuntu 22.04, 24.04, and 26.04**. This is *not* a guarantee that all UI, media features, GPU drivers or separation models have been exercised on those systems. Real desktop/GPU testing is still required.
- This is the **online/bootstrap** flavor: a portable Python 3.12 interpreter plus bootstrap dependencies are bundled, but heavy PyTorch/CPU/CUDA inference environments and models are downloaded separately. Linux runtime installation uses the helper below; upstream's GUI runtime manager is currently Windows-only. The distribution's Python version is not used as a substitute for 3.12.
- The `.deb` depends on standard Linux packages including WebKitGTK 4.1, GTK 3, FFmpeg, and aria2. They are resolved by `apt` on your system. It does **not** bundle CUDA or an NVIDIA driver.

## Download / build in GitHub Actions

1. Open [**Actions → Build Linux DEB**](https://github.com/ChrisTorng/pymss-studio-linux/actions/workflows/release-linux.yml) and choose **Run workflow** on `main`.
2. Leave the version override blank to derive the package version from the latest reachable upstream-style `vX.Y.Z` Git tag, or provide a specific `X.Y.Z` override when building a known release.
3. The build job creates **one** `.deb`. CI then attempts installation and bundled-Python smoke tests in three Ubuntu environments.
4. When the workflow completes, open the run and download the **`pymss-studio-linux-amd64`** artifact ZIP. Unzip it to get the `.deb`, `install-linux-deb.sh`, `setup-linux-runtime.sh`, and `SHA256SUMS` (older artifacts contain only the DEB and checksums). Do not treat a failed validation job as a verified release.

Builds on `main` are **manual** (`workflow_dispatch`), so syncing upstream does not automatically rebuild Linux packages or create duplicate releases. Pushes to the dedicated `linux-validation` branch run the same pipeline for packaging fixes. Workflow artifacts expire according to the repository's GitHub Actions retention settings. They are not yet permanent GitHub Releases.

## Install on Ubuntu 26.04 (also 22.04 / 24.04)

Open a terminal in the directory holding the downloaded `.deb`:

```bash
sha256sum --check SHA256SUMS
bash ./install-linux-deb.sh ./*.deb
bash ./setup-linux-runtime.sh cuda   # RTX 4090 / NVIDIA; use cpu for CPU-only
```

The helper resolves dependencies with APT. It stages a readable copy under `/var/tmp` before installation, then removes that copy. This lets APT's `_apt` sandbox read the DEB even if your home directory is private; your home permissions remain unchanged.

For an older artifact without the helper, use the same staging approach:

```bash
(
  set -eu
  deb="$(realpath ./*.deb)"
  stage="$(mktemp -d /var/tmp/pymss-studio-install.XXXXXX)"
  trap 'rm -f -- "$stage/pymss-studio.deb"; rmdir -- "$stage"' EXIT
  chmod 0755 "$stage"
  install -m 0644 -- "$deb" "$stage/pymss-studio.deb"
  sudo apt update
  sudo apt install "$stage/pymss-studio.deb"
)
```

Use APT, **not** `dpkg -i`, so system dependencies are resolved automatically. A final `Download is performed unsandboxed as root ... couldn't be accessed by user '_apt' ... Permission denied` notice from an earlier direct installation indicates that APT fell back to root to read a private source path. It does not by itself mean installation failed; verify with `dpkg-query -W -f='${Status}\n' pymss-studio` (expected: `install ok installed`). Staging fixes the access problem instead of hiding the notice or weakening home-directory permissions.

Close Pymss Studio while configuring a runtime. The helper uses the installed Python 3.12 and upstream Worker, installs the manifest's pinned packages into `~/.pymss-studio/runtime-envs/`, and activates the selected backend. An existing environment is validated and activated without downloading it again. To repair/reinstall it explicitly, run `bash ./setup-linux-runtime.sh cuda --reinstall`. No sudo is needed for runtime setup; the GUI must also run as your regular user.

Then start **Pymss Studio** from the desktop launcher and finish onboarding. The Linux frontend currently says **“Runtime management is available only on Windows”**; installation/switching/repair on Linux uses the helper instead. The application can detect and use the configured runtime. The Python manifest declaring Linux support does not imply that the GUI runtime-management controls are enabled on Linux.

For older artifacts without this helper, download [setup-linux-runtime.sh](https://github.com/ChrisTorng/pymss-studio-linux/blob/main/scripts/setup-linux-runtime.sh) using GitHub's **Download raw file** action, then run it as above. The script uses APT's installed package paths, not the distribution's Python 3.14.

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
2. Close Pymss Studio, then run **`bash ./setup-linux-runtime.sh cuda`** from the extracted artifact directory. The helper uses the same upstream runtime installer that Windows exposes through the GUI. Allow it to download CUDA-enabled PyTorch and inference packages into your home directory, then start the GUI.
3. After the installation, verify from the Ubuntu terminal:

```bash
nvidia-smi
~/.pymss-studio/runtime-envs/cuda/bin/python -c 'import torch; print("torch:", torch.__version__, "CUDA:", torch.version.cuda); print("available:", torch.cuda.is_available()); print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "not available")'
```

For a working RTX 4090 setup the probe should report CUDA available and name the NVIDIA GPU. The `CUDA Version` field of `nvidia-smi` describes driver capability, not proof that a system-wide CUDA Toolkit is installed.

**Backend and distribution terminology:**

| Term | Meaning in this fork | Linux status |
| --- | --- | --- |
| **Online** | Small initial desktop package with bundled Python 3.12 bootstrap; install CPU/CUDA inference runtime separately with the Linux helper | **Current Linux DEB strategy** |
| **CUDA** | Preinstalled NVIDIA-specific PyTorch inference environment in the release package | Not separately bundled; install with the Linux helper after installing the online DEB |
| **CPU** | Preinstalled CPU-only PyTorch inference environment in the release package | Not separately bundled; CPU remains installable with `bash ./setup-linux-runtime.sh cpu` |
| **ROCm** | AMD GPU inference environment; upstream Windows package is based on Windows-specific ROCm wheels | **Not supported by the current Studio Linux runtime manifest** |
| **Application update** | Update the installed Tauri desktop program | Linux: download/reinstall a newer DEB with `sudo apt install ./new-package.deb`; the Linux in-app auto-updater is not supported |
| **Runtime/core update** | Update or repair Python `pymss` / `pymss-core` dependencies within the managed inference environment | The backend supports it, but Linux's GUI manager is read-only; the helper's `--reinstall` restores the versions pinned by the installed app |

**What CI does not prove:** GitHub-hosted standard Ubuntu runners do not expose your RTX 4090 and cannot verify CUDA GPU inference. The build pipeline only confirms that the package can be installed, its bundled Python is functional and the runtime manifest declares Linux/CUDA. Full validation needs a real Ubuntu machine with an NVIDIA driver and a model separation test.

## Compatibility and limitations

- **Ubuntu 26.04:** Ubuntu's standard Python may be 3.14, while upstream's runtime manifest requests 3.12. The bundled standalone Python solves the bootstrap version mismatch. The runtime helper has been exercised on Ubuntu 26.04.1 with an RTX 4090; other machines still need their own driver/model checks.
- **Desktop session:** This is a native Tauri 2 / GTK / WebKitGTK app, not a web server. You need a graphical desktop; Docker is not the supported distribution mechanism here.
- **Audio tools:** FFmpeg/FFprobe and aria2 are provided through Ubuntu's package manager. If features cannot find them, check `command -v ffmpeg ffprobe aria2c`.
- **GPU acceleration:** Install a compatible driver and select the matching PyTorch runtime from the application. CUDA is not embedded in the initial DEB, Ubuntu 26.04.1 / RTX 4090 has passed CUDA 12.8 worker inference; this is not a certification of every model or GPU.
- **File locations/permissions:** The packaged bootstrap under `/usr` is read-only for regular users; inference environments are installed into the user's home directory on Linux. This matters if an upstream change tries to write inside application resources.
- **Validation:** The CI installation matrix is an automated smoke check, *not* an end-to-end AI separation test. On hardware, verify launch, runtime download, one model load, audio import and export.
- **Upstream synchronization:** Use GitHub's **Sync fork**. Keep Linux-specific changes confined to this documentation, `.github/workflows/release-linux.yml`, and the Linux-only scripts. The preparation script applies transient frontend compatibility overlays to bypass WebKitGTK's crashing ripple transition; it fails for review if upstream changes that guard. Do not rename the application's internal identifier or edit upstream Windows/macOS build scripts.

## Linux GUI compatibility overlay

On Ubuntu 26.04.1 with WebKitGTK 2.52.6, completing onboarding reproduced a native `SIGSEGV` (exit 139) inside `libwebkit2gtk-4.1.so.0`. The failing action calls `document.startViewTransition`. Disabling DMA-BUF or compositing did not resolve it in the desktop test.

The Linux preparation script adds a single Linux guard to `src/utils/theme.ts` **only in the transient build workspace**, preserving the normal update callback while omitting the ripple ViewTransition. The tracked application source remains identical to the merged upstream; these compatibility changes are generated only while building Linux. The overlay applies to Linux packages and is explicitly checked so an upstream source change cannot silently bypass it.

The Linux preparation script also injects `scripts/linux-media-compat.js` into the transient frontend entry point. This works around WebKitGTK's inability to play local Tauri `asset:` audio URLs ([Tauri #8654](https://github.com/tauri-apps/tauri/issues/8654)). Normal playback is attempted first; only a local-asset `NotSupportedError` triggers a fetch-to-Blob fallback. Owned Blob URLs and pending reads are released when the existing preview cache removes or replaces the source. Other platforms and ordinary HTTP/Blob sources keep their normal behavior. A selected preview is held in memory until released; this is not a streaming server.

## FunASR optional component on Linux

The Linux resource overlay in `scripts/linux-optional-packages-compat.py` preserves the
venv's absolute interpreter path when optional components launch Python subprocesses.
Resolving a Linux venv's `bin/python` symlink selects the shared bootstrap interpreter
instead, so the original installer could download FunASR dependencies and then incorrectly
report **“The active runtime does not include PyTorch”**. Refresh only rechecks availability;
the failed staged installation was correctly discarded, which explains the Install button
returning after Refresh.

The overlay changes three executable-path expressions in the bundled resource copy only.
Tracked upstream Python files remain unchanged. The build fails for review if upstream
changes these expressions. CI exercises real symlinked CPU/CUDA venvs, independent runtime
identities, metadata discovery and compatible-torchaudio selection without downloading Torch.

On the Ubuntu 26.04.1 / RTX 4090 validation host, the fixed worker installed FunASR 1.3.26
and torchaudio 2.7.1+cu128 into the managed optional sidecar. The formally installed worker's
status query then returned `installed: true`. Deep imports used the existing CUDA venv's
PyTorch 2.7.1+cu128 and preserved the user's pymss 2.1.9 core overlay. No second Torch copy
or CUDA runtime reinstall was needed. Existing app installations need the newer DEB to
retain this fix for future component installation/removal.

## Local source build (developers)

On Ubuntu, install [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/) plus Node.js 22, pnpm 10.33.2, Rust stable, and Python 3.12. For a normal developer build, see the [upstream README](https://github.com/pymss-project/pymss-studio#development-and-verification). The release workflow handles portable-Python staging; `pnpm tauri build --bundles deb` alone does **not** reproduce its runtime bundle.

The packaging workflow uses [python-build-standalone](https://github.com/astral-sh/python-build-standalone), following upstream's macOS approach but with a GNU/Linux interpreter.

## Workflow hygiene

Original `ci.yml`, `release.yml`, `release-windows.yml`, and `release-macos.yml` remain unchanged to minimize upstream merge conflicts. Disable these four **in this fork** using **Actions → select workflow → … → Disable workflow**. Keep **Build Linux DEB** enabled. The connected GitHub tools currently cannot change the GitHub-side enabled/disabled state.

To report issues with **Linux packaging**, open an issue on this fork; for **application functionality**, check upstream first.

## Verification record — 2026-10-18

Validated package: **`0.0.21-5`**, upstream app version **`0.0.21`**, source commit [`62bd6d1`](https://github.com/ChrisTorng/pymss-studio-linux/commit/62bd6d153c5ea34fa6f7da6b724c08841a532316). Upstream was merged through [`961509f`](https://github.com/pymss-project/pymss-studio/commit/961509f09986fc8358f7a7f783e4bcf3b062110a).

- **CI:** [Actions run 39123888329](https://github.com/ChrisTorng/pymss-studio-linux/actions/runs/39123888329) built on Ubuntu 22.04 and passed DEB installation, bundled Python and native-library checks on Ubuntu 22.04, 24.04 and 26.04. These runners did not perform GPU inference.
- **DEB SHA256:** `5064624bcc3bda372b22f92635ab15183ef80b36e91880f4a6ac027dc697afa6`.
- **Host installation:** upgraded from `0.0.21` to `0.0.21-5` using the staged installer. APT completed without the `_apt Permission denied` notice; the home directory remained private (`0750`), and staging was removed afterward. The installed `/usr/bin/pymss-studio` matched the tested DEB binary.
- **Hardware:** Ubuntu 26.04.1 LTS, NVIDIA GeForce RTX 4090, NVIDIA driver 595.99.02. The host's Python 3.14.4 was not used for inference.
- **Runtime:** bundled Python 3.12.13; PyTorch 2.7.1+cu128 / CUDA 12.8; pymss 2.1.8; pymss-core 0.1.11. CUDA matrix multiplication and `pip check` passed.
- **Real model:** `scnet_checkpoint_musdb18.ckpt`, downloaded through Studio's Worker. A 15-second, 44.1 kHz stereo excerpt was separated on `cuda:0` into drums, bass, other and vocals. All four WAVs had 661,500 stereo frames, finite samples and nonzero RMS.
- **Desktop flow:** onboarding, native file import, model selection, CUDA separation and local vocal preview playback/pause were exercised using the DEB's actual Tauri/WebKitGTK application. The final GUI Worker completed the 15-second clip in 2.737 seconds. A subsequent separation using the formally installed Worker and Python path completed in 2.39 seconds (individual local runs, not a benchmark). Preview advanced normally and reported a 15-second duration.
- **Music credit:** “Let's Go Fishin'” by Karissa Hobbs, [Free Music Archive](https://freemusicarchive.org/music/Karissa_Hobbs/Age_of_Flowers/09_Lets_Go_Fishin), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), obtained from librosa's public example audio collection; the test used seconds 30–45.
- **Install helper:** tested with a private home / restrictive umask, a DEB filename containing spaces, APT failure propagation and temporary-file cleanup. It stages only the DEB and does not change home-directory permissions.

This verifies the tested model and host. It does not establish desktop/GPU support on every matrix OS, certify all separation models, or measure separation quality against reference stems.

## References

- [Upstream Pymss Studio](https://github.com/pymss-project/pymss-studio)
- [Tauri 2 Debian bundling](https://v2.tauri.app/distribute/debian/)
- [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/)
- [GitHub Actions runner images](https://github.com/actions/runner-images)
