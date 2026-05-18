"""
Elicitation engine for /init.
Asks structured questions, validates answers, returns filled context
ready for the scaffold step.
"""

from dataclasses import dataclass, field
from pathlib import Path
from datetime import date
import json

import anthropic
from rich.console import Console
from rich.prompt import Prompt, Confirm
from rich.panel import Panel

console = Console()

INIT_QUESTIONS = [
    {
        "key": "project_name",
        "question": "Project name?",
        "hint": "e.g. ConstructSyncAI",
        "required": True,
    },
    {
        "key": "project_description",
        "question": "Describe what this project does in 1–2 sentences.",
        "hint": "e.g. AI-powered construction site management platform",
        "required": True,
    },
    {
        "key": "app_type",
        "question": "What type of application?",
        "hint": "Web app / Mobile app / API / CLI / Desktop / Mixed",
        "required": True,
    },
    {
        "key": "frontend",
        "question": "Frontend stack?",
        "hint": "e.g. Next.js, React, Vue, None",
        "required": False,
        "default": "None",
    },
    {
        "key": "backend",
        "question": "Backend stack?",
        "hint": "e.g. FastAPI, Express, Django, None",
        "required": False,
        "default": "None",
    },
    {
        "key": "database",
        "question": "Database?",
        "hint": "e.g. PostgreSQL, MongoDB, SQLite, None",
        "required": False,
        "default": "None",
    },
    {
        "key": "users",
        "question": "Who are the main users?",
        "hint": "e.g. Project managers, field engineers, contractors",
        "required": True,
    },
    {
        "key": "mvp_scope",
        "question": "What should the MVP focus on? (most important features)",
        "hint": "e.g. Task management, progress tracking, document upload",
        "required": True,
    },
    {
        "key": "out_of_scope",
        "question": "What is explicitly OUT of scope for v1?",
        "hint": "e.g. Mobile app, payments, third-party integrations",
        "required": False,
        "default": "To be defined.",
    },
    {
        "key": "custom_rules",
        "question": "Any coding rules or conventions for the team? (optional)",
        "hint": "e.g. Use async/await everywhere, snake_case for Python",
        "required": False,
        "default": "Follow language-standard conventions.",
    },
]


@dataclass
class ElicitationResult:
    answers: dict[str, str] = field(default_factory=dict)
    project_name: str = ""
    project_root: Path = Path(".")


def run_elicitation(base_dir: Path = Path(".")) -> ElicitationResult:
    """
    Run interactive Q&A in the terminal.
    Returns filled answers dict.
    """
    console.print()
    console.print(Panel(
        "[bold]sdd-kit[/bold] — Let's set up your project.\n"
        "[dim]Answer a few questions and the AI will handle everything else.[/dim]",
        border_style="dim",
    ))
    console.print()

    answers: dict[str, str] = {}

    for q in INIT_QUESTIONS:
        hint = f"[dim]{q['hint']}[/dim]" if q.get("hint") else ""
        if hint:
            console.print(f"  {hint}")

        default = q.get("default", "")
        answer = Prompt.ask(
            f"  [bold]{q['question']}[/bold]",
            default=default if default else None,
        )

        if not answer and q.get("required"):
            console.print("  [red]This field is required.[/red]")
            answer = Prompt.ask(f"  [bold]{q['question']}[/bold]")

        answers[q["key"]] = answer or default
        console.print()

    project_name = answers.get("project_name", "my-project")
    project_root = base_dir / _slugify(project_name)

    console.print(Panel(
        f"[bold]Project:[/bold] {project_name}\n"
        f"[bold]Location:[/bold] {project_root}\n"
        f"[bold]Stack:[/bold] {answers.get('frontend', 'None')} + "
        f"{answers.get('backend', 'None')} + {answers.get('database', 'None')}",
        title="Summary",
        border_style="green",
    ))

    if not Confirm.ask("  Looks good? Start building?", default=True):
        raise KeyboardInterrupt("User cancelled.")

    answers["created_date"] = str(date.today())
    answers["infra"] = "Docker"
    answers["language_versions"] = _infer_versions(answers)
    answers["users_description"] = answers.pop("users", "")

    return ElicitationResult(
        answers=answers,
        project_name=project_name,
        project_root=project_root,
    )


def fill_template(template_path: Path, answers: dict[str, str]) -> str:
    """Replace {{key}} placeholders in a template file."""
    text = template_path.read_text(encoding="utf-8")
    for key, value in answers.items():
        text = text.replace(f"{{{{{key}}}}}", value)
    # Remove any unfilled placeholders
    import re
    text = re.sub(r"\{\{[^}]+\}\}", "TBD", text)
    return text


def _slugify(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _infer_versions(answers: dict) -> str:
    parts = []
    if "python" in answers.get("backend", "").lower() or \
       "fastapi" in answers.get("backend", "").lower() or \
       "django" in answers.get("backend", "").lower():
        parts.append("Python 3.11+")
    if any(x in answers.get("frontend", "").lower() for x in ["next", "react", "vue", "node"]):
        parts.append("Node 20+")
    return ", ".join(parts) if parts else "See stack above"
