"""
CLI — `sdd` command.
SDD = Spec-Driven Development.

The actual skill loops (/init, /plan, /ux, /build, /test, /refactor,
/review, /update-doc) run inside VS Code as the `@sdd` chat participant — they
use the Copilot language-model API so users don't need any extra keys.

This CLI is therefore a thin installer + reference surface:

    sdd install-extension   # install the VS Code extension
    sdd skills              # list available skills and their context profile
"""

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table
from rich import box

from sdd_kit.skills import manifests

app = typer.Typer(
    name="sdd",
    help="SDD Kit — Spec-Driven Development toolkit. Skills run inside VS Code via @sdd.",
    add_completion=False,
)
console = Console()


@app.command(name="install-extension")
def install_extension(
    vsix: Optional[Path] = typer.Option(
        None,
        "--vsix",
        help="Path to a local .vsix file. Defaults to the bundled VSIX, then GitHub Releases.",
    ),
    force: bool = typer.Option(False, "--force", help="Reinstall even if already installed."),
):
    """Install the SDD Kit VS Code extension. Run this once after `pip install sdd-kit`."""
    from sdd_kit.extension.installer import install_extension as _install

    _install(vsix=vsix, force=force)


@app.command()
def skills():
    """List all SDD skills (use them from VS Code chat as `@sdd /<skill>`)."""
    table = Table(box=box.SIMPLE, header_style="bold")
    table.add_column("Skill", style="bold cyan", width=14)
    table.add_column("What it does", width=46)
    table.add_column("Context loaded", style="dim", width=24)
    table.add_column("Steps", style="dim")
    for m in manifests.list_skills():
        ctx = ", ".join(s.value.split(":")[0] for s in m.context_needs) or "elicits"
        steps = " → ".join(s.value for s in m.loop_steps)
        table.add_row(m.name, m.description[:46], ctx, steps)
    console.print()
    console.print(table)
    console.print(
        "\n[dim]Run a skill from VS Code chat:[/dim]  [bold]@sdd /init a todo app[/bold]\n"
    )


if __name__ == "__main__":
    app()
