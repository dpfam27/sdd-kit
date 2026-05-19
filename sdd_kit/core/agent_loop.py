"""
Agent loop — shared execution engine.
Every skill (Phase 1 init + all Phase 2 on-demand skills) runs through this.

Loop steps per LoopStep enum:
  ELICIT   → structured Q&A, builds context from scratch
  PLAN     → AI breaks work into ordered tasks from injected context
  SCAFFOLD → AI writes/modifies files
  BUILD    → runs install + compile commands
  TEST     → runs test suite, retries on failure up to max_retries
  REPORT   → checklist of what was done + suggested next tasks
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from dataclasses import dataclass, field
from typing import Callable

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn

from sdd_kit.skills.manifests import SkillManifest, LoopStep
from sdd_kit.core.context_selector import ContextSelector, InjectedContext

console = Console()


@dataclass
class LoopResult:
    success: bool
    checklist: list[str] = field(default_factory=list)
    next_suggestions: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class ElicitedAnswers:
    """Collected from user during ELICIT step."""
    raw: dict[str, str] = field(default_factory=dict)

    def to_context_string(self) -> str:
        lines = ["## user answers"]
        for q, a in self.raw.items():
            lines.append(f"**{q}**\n{a}")
        return "\n\n".join(lines)


class AgentLoop:
    """
    Runs a skill's loop steps in order.
    Handles retry logic in TEST step.
    Surfaces to user only when done (or on unrecoverable failure).

    ai_caller: callable(prompt: str) -> str
        Injected by the VS Code extension — calls VS Code LM API (Copilot).
    """

    def __init__(
        self,
        project_root: Path,
        manifest: SkillManifest,
        ai_caller: Callable[[str], str],
        elicit_fn: Callable[[list[str]], dict[str, str]] | None = None,
    ):
        self.root = project_root
        self.manifest = manifest
        self.ai_caller = ai_caller
        self.elicit_fn = elicit_fn
        self.selector = ContextSelector(project_root)

    def run(self) -> LoopResult:
        answers = ElicitedAnswers()
        context: InjectedContext | None = None

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            transient=True,
        ) as progress:

            for step in self.manifest.loop_steps:

                if step == LoopStep.ELICIT:
                    task = progress.add_task("Collecting project info...")
                    answers = self._elicit(progress, task)

                elif step == LoopStep.PLAN:
                    progress.update(progress.add_task("Planning tasks..."), description="Planning tasks...")
                    context = self.selector.select(self.manifest)
                    console.print(
                        f"  [dim]context: ~{context.token_estimate} tokens "
                        f"({len(context.sections)} sections)[/dim]"
                    )
                    self._plan(context, answers)

                elif step == LoopStep.SCAFFOLD:
                    progress.update(progress.add_task("Scaffolding files..."), description="Writing files...")
                    self._scaffold(context, answers)

                elif step == LoopStep.BUILD:
                    progress.update(progress.add_task("Building..."), description="Building project...")
                    ok, err = self._build()
                    if not ok:
                        return LoopResult(success=False, error=f"Build failed:\n{err}")

                elif step == LoopStep.TEST:
                    passed = self._test_with_retry(progress)
                    if not passed:
                        return LoopResult(
                            success=False,
                            error=f"Tests still failing after {self.manifest.max_retries} retries.",
                        )

                elif step == LoopStep.REPORT:
                    return self._report(context, answers)

        return LoopResult(success=True)

    # ── step implementations ──────────────────────────────────────

    def _elicit(self, progress, task) -> ElicitedAnswers:
        """
        Ask the AI what questions to ask, then collect answers from user.
        For VS Code integration, elicit_fn is provided by the chat panel.
        In CLI mode, falls back to interactive prompts.
        """
        questions = self._ai_generate_questions()
        answers = {}

        progress.stop()
        console.print()
        for q in questions:
            answers[q] = console.input(f"  [bold]{q}[/bold]\n  > ") if not self.elicit_fn else ""

        if self.elicit_fn:
            answers = self.elicit_fn(questions)

        console.print()
        return ElicitedAnswers(raw=answers)

    def _ai_generate_questions(self) -> list[str]:
        prompt = (
            f"You are sdd-kit. Skill: {self.manifest.name} — {self.manifest.description}\n"
            "Return a JSON array of 3–6 short, essential questions to ask the user "
            "before starting. Use the user's language. Return ONLY the JSON array, no markdown."
        )
        import json
        text = self.ai_caller(prompt)
        try:
            return json.loads(text)
        except Exception:
            return ["What is the project name?", "What should it do?", "What tech stack?"]

    def _plan(self, context: InjectedContext | None, answers: ElicitedAnswers) -> list[str]:
        ctx_text = context.render() if context else ""
        prompt = (
            f"{ctx_text}\n\n{answers.to_context_string()}\n\n"
            "Return a JSON array of ordered task strings the agent should execute. "
            "Each task maps to one file or one command. Return ONLY the JSON array."
        )
        import json
        try:
            self._tasks = json.loads(self.ai_caller(prompt))
        except Exception:
            self._tasks = []
        return self._tasks

    def _scaffold(self, context: InjectedContext | None, answers: ElicitedAnswers):
        ctx_text = context.render() if context else ""
        tasks_text = "\n".join(f"- {t}" for t in getattr(self, "_tasks", []))
        prompt = (
            "Write all files needed. For each file use EXACTLY:\n"
            "<<<FILE path/to/file.ext>>>\n<contents>\n<<<END>>>\n\n"
            f"{ctx_text}\n\n{answers.to_context_string()}\n\n"
            f"Tasks:\n{tasks_text}\n\n"
            f"Skill: {self.manifest.name}\nProduces: {self.manifest.produces}"
        )
        self._write_files(self.ai_caller(prompt))

    def _write_files(self, raw: str):
        """Parse <<<FILE>>> blocks and write to disk."""
        import re
        pattern = re.compile(r"<<<FILE (.+?)>>>\n(.*?)<<<END>>>", re.DOTALL)
        for match in pattern.finditer(raw):
            rel_path, content = match.group(1).strip(), match.group(2)
            filepath = self.root / rel_path
            filepath.parent.mkdir(parents=True, exist_ok=True)
            filepath.write_text(content, encoding="utf-8")
            console.print(f"  [green]wrote[/green] {rel_path}")

    def _build(self) -> tuple[bool, str]:
        """Detect stack and run appropriate build command."""
        commands = []

        if (self.root / "pyproject.toml").exists() or (self.root / "requirements.txt").exists():
            commands.append(["pip", "install", "-e", ".", "--quiet"])
        if (self.root / "package.json").exists():
            commands.append(["npm", "install", "--silent"])
        if (self.root / "docker-compose.yml").exists():
            commands.append(["docker", "compose", "build", "--quiet"])

        for cmd in commands:
            result = subprocess.run(cmd, cwd=self.root, capture_output=True, text=True)
            if result.returncode != 0:
                return False, result.stderr

        return True, ""

    def _test_with_retry(self, progress) -> bool:
        """Run tests, auto-fix failures, retry up to max_retries."""
        for attempt in range(1, self.manifest.max_retries + 1):
            desc = f"Testing (attempt {attempt}/{self.manifest.max_retries})..."
            progress.add_task(desc)

            ok, output = self._run_tests()
            if ok:
                console.print(f"  [green]✓[/green] tests passed")
                return True

            console.print(f"  [yellow]⚠[/yellow] tests failed, auto-fixing...")
            self._auto_fix_failures(output)

        return False

    def _run_tests(self) -> tuple[bool, str]:
        """Detect test runner and execute."""
        if (self.root / "pytest.ini").exists() or (self.root / "pyproject.toml").exists():
            result = subprocess.run(
                ["python", "-m", "pytest", "--tb=short", "-q"],
                cwd=self.root, capture_output=True, text=True
            )
            return result.returncode == 0, result.stdout + result.stderr

        if (self.root / "package.json").exists():
            result = subprocess.run(
                ["npm", "test", "--", "--passWithNoTests"],
                cwd=self.root, capture_output=True, text=True
            )
            return result.returncode == 0, result.stdout + result.stderr

        return True, "no test runner detected"

    def _auto_fix_failures(self, test_output: str):
        prompt = (
            "Auto-fix mode. Given test failures, write corrected files using "
            "<<<FILE path>>>\n...\n<<<END>>> format. Fix only what's needed.\n\n"
            f"Test failures:\n{test_output}"
        )
        self._write_files(self.ai_caller(prompt))

    def _report(self, context: InjectedContext | None, answers: ElicitedAnswers) -> LoopResult:
        ctx_text = context.render() if context else ""
        prompt = (
            f"{ctx_text}\n\n{answers.to_context_string()}\n\n"
            "Return a JSON object with two keys:\n"
            "  checklist: list of strings — what was built/changed\n"
            "  next: list of 3 strings — suggested next tasks\n"
            "Return ONLY the JSON object. Use the user's language."
        )
        import json
        try:
            data = json.loads(self.ai_caller(prompt))
            return LoopResult(
                success=True,
                checklist=data.get("checklist", []),
                next_suggestions=data.get("next", []),
            )
        except Exception:
            return LoopResult(success=True, checklist=["Done."], next_suggestions=[])