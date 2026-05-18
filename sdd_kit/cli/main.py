from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console


app = typer.Typer(add_completion=False, help="SDD Kit — Spec-Driven Development")
console = Console()


GITHUB_REPO = os.environ.get("SDD_KIT_REPO", "dpfam27/sdd-kit")
VSIX_ASSET_NAME_PREFIX = os.environ.get("SDD_KIT_VSIX_PREFIX", "sdd-kit-")


@dataclass
class ReleaseAsset:
    name: str
    url: str


def _require_code_cli() -> str:
    code = shutil.which("code")
    if not code:
        raise typer.BadParameter(
            "VS Code CLI `code` not found on PATH.\n"
            "Install VS Code then run:\n"
            "  Cmd+Shift+P → 'Shell Command: Install \'code\' command in PATH'"
        )
    return code


def _http_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "sdd-kit",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else ""
        raise RuntimeError(f"GitHub API error {e.code} for {url}: {body}")


def _find_latest_vsix_asset() -> ReleaseAsset:
    api = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    data = _http_json(api)
    assets = data.get("assets", []) or []

    for a in assets:
        name = a.get("name", "")
        if name.endswith(".vsix") and name.startswith(VSIX_ASSET_NAME_PREFIX):
            return ReleaseAsset(name=name, url=a.get("browser_download_url"))

    # Fallback: any .vsix
    for a in assets:
        name = a.get("name", "")
        if name.endswith(".vsix"):
            return ReleaseAsset(name=name, url=a.get("browser_download_url"))

    raise RuntimeError(
        "No .vsix asset found in the latest GitHub release. "
        "Create a release and upload a VSIX, or set SDD_KIT_REPO/SDD_KIT_VSIX_PREFIX."
    )


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "sdd-kit"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest.write_bytes(resp.read())


@app.command()
def version() -> None:
    """Print installed version."""
    # Avoid importing package metadata if not available
    try:
        from importlib.metadata import version as pkg_version

        console.print(pkg_version("sdd-kit"))
    except Exception:
        console.print("unknown")


@app.command("install-extension")
def install_extension(
    vsix_path: Optional[Path] = typer.Option(
        None,
        "--vsix",
        help="Path to a local .vsix file. If omitted, downloads latest from GitHub Releases.",
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
        resolve_path=True,
    ),
    force: bool = typer.Option(
        False,
        "--force",
        help="Reinstall even if already installed.",
    ),
) -> None:
    """Install the VS Code extension.

    By default downloads the latest VSIX from GitHub releases of this repo and installs via `code --install-extension`.
    """
    code = _require_code_cli()

    with tempfile.TemporaryDirectory(prefix="sdd-kit-") as tmp:
        tmpdir = Path(tmp)
        if vsix_path is None:
            asset = _find_latest_vsix_asset()
            dest = tmpdir / asset.name
            console.print(f"Downloading [bold]{asset.name}[/bold] from GitHub releases...")
            _download(asset.url, dest)
            vsix_path = dest
        else:
            console.print(f"Installing from local VSIX: {vsix_path}")

        cmd = [code, "--install-extension", str(vsix_path)]
        if force:
            cmd.append("--force")

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to install extension")

        console.print("✓ VS Code extension installed")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
