"""VS Code extension installer.

This module is invoked from the CLI command:

    sdd install-extension

It installs the bundled VSIX if present (preferred for offline installs),
or falls back to downloading the latest VSIX from GitHub Releases.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Optional


DEFAULT_REPO = "dpfam27/sdd-kit"
DEFAULT_VSIX_PREFIX = "sdd-kit"


def _find_code_cli() -> str:
    """Return path to VS Code or Cursor CLI (`code` or `cursor`)."""
    code = shutil.which("code") or shutil.which("cursor")
    if not code:
        raise RuntimeError(
            "Couldn't find the 'code' or 'cursor' CLI on PATH.\n"
            "In your editor, run: Cmd+Shift+P → 'Shell Command: Install \'code\' (or \'cursor\') command in PATH'."
        )
    return code


def _run_code_install(code_cli: str, vsix_path: Path, *, force: bool) -> None:
    cmd = [code_cli, "--install-extension", str(vsix_path)]
    if force:
        cmd.append("--force")
    subprocess.run(cmd, check=True)


def _bundled_vsix() -> Optional[Path]:
    """Return a path to any VSIX shipped inside the Python package."""
    ext_dir = Path(__file__).resolve().parent
    candidates = sorted(ext_dir.glob("*.vsix"))
    return candidates[0] if candidates else None


def _download_latest_vsix(*, repo: str, prefix: str) -> Path:
    """Download the latest VSIX asset from GitHub releases into a temp file."""
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "sdd-kit",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    assets = data.get("assets") or []
    vsix_assets = [a for a in assets if str(a.get("name", "")).endswith(".vsix")]
    if prefix:
        vsix_assets = [a for a in vsix_assets if str(a.get("name", "")).startswith(prefix)]

    if not vsix_assets:
        raise RuntimeError(
            f"No .vsix asset found in latest GitHub release for {repo}. "
            "Create a GitHub Release and upload the VSIX first."
        )

    asset = vsix_assets[0]
    download_url = asset.get("browser_download_url")
    if not download_url:
        raise RuntimeError("GitHub asset is missing browser_download_url")

    tmp_dir = Path(tempfile.mkdtemp(prefix="sdd-kit-"))
    out_path = tmp_dir / asset["name"]
    urllib.request.urlretrieve(download_url, out_path)  # nosec - downloading known binary
    return out_path


def install_extension(*, vsix: Optional[Path] = None, force: bool = False) -> None:
    """Install the SDD Kit VS Code extension.

    Args:
        vsix: Optional path to a local .vsix file.
        force: Pass --force to VS Code install.
    """

    code_cli = _find_code_cli()

    if vsix is not None:
        vsix_path = Path(vsix).expanduser().resolve()
        if not vsix_path.exists():
            raise RuntimeError(f"VSIX not found: {vsix_path}")
        _run_code_install(code_cli, vsix_path, force=force)
        return

    bundled = _bundled_vsix()
    if bundled is not None and bundled.exists():
        _run_code_install(code_cli, bundled, force=force)
        return

    repo = os.environ.get("SDD_KIT_REPO", DEFAULT_REPO)
    prefix = os.environ.get("SDD_KIT_VSIX_PREFIX", DEFAULT_VSIX_PREFIX)
    downloaded = _download_latest_vsix(repo=repo, prefix=prefix)
    _run_code_install(code_cli, downloaded, force=force)
