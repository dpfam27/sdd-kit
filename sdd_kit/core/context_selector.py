"""
Context selector — the token-saving core of sdd-kit.

For each skill, loads only the declared DocSections from disk.
constitution.md is always partially injected (rules + stack).
/update-doc is the only skill that gets full docs — but via diff headers only.
"""

from __future__ import annotations

import re
from pathlib import Path
from dataclasses import dataclass

from sdd_kit.skills.manifests import DocSection, SkillManifest


@dataclass
class InjectedContext:
    """What gets passed into an agent loop."""
    sections: dict[str, str]   # section_key -> content
    token_estimate: int

    def render(self) -> str:
        """Render all sections into a single context string."""
        parts = []
        for key, content in self.sections.items():
            parts.append(f"<!-- {key} -->\n{content}")
        return "\n\n".join(parts)


class ContextSelector:
    """
    Reads the SDD doc store and returns only the sections
    declared in a skill's manifest.context_needs.
    """

    # Maps DocSection → (filename, header_pattern or None for full file)
    SECTION_MAP: dict[DocSection, tuple[str, str | None]] = {
        DocSection.CONSTITUTION_RULES: ("docs/constitution.md", "## rules"),
        DocSection.CONSTITUTION_STACK: ("docs/constitution.md", "## stack"),
        DocSection.CONSTITUTION_USERS: ("docs/constitution.md", "## users"),
        DocSection.CONSTITUTION_FULL:  ("docs/constitution.md", None),
        DocSection.PRD:                ("docs/PRD.md", None),
        DocSection.ARCHITECTURE:       ("docs/ARCHITECTURE.md", None),
        DocSection.FEATURE_SPEC:       ("docs/FEATURE_SPEC_MVP.md", None),
        DocSection.TEST_PLAN:          ("docs/TEST_PLAN.md", None),
        DocSection.CHANGELOG:          ("docs/CHANGELOG.md", None),
    }

    # Rough estimate: 1 token ≈ 4 chars
    CHARS_PER_TOKEN = 4

    def __init__(self, project_root: Path):
        self.root = project_root

    def select(self, manifest: SkillManifest) -> InjectedContext:
        """
        Build the minimal context for a skill.
        Always includes constitution:rules + constitution:stack
        unless manifest.context_needs is empty (init skill).
        """
        needs = list(manifest.context_needs)

        # Always inject these two constitution sections as baseline
        # (except /init which has nothing yet)
        if needs and DocSection.CONSTITUTION_FULL not in needs:
            for baseline in [DocSection.CONSTITUTION_RULES, DocSection.CONSTITUTION_STACK]:
                if baseline not in needs:
                    needs.insert(0, baseline)

        sections: dict[str, str] = {}
        for doc_section in needs:
            content = self._load_section(doc_section)
            if content:
                sections[doc_section.value] = content

        total_chars = sum(len(v) for v in sections.values())
        token_estimate = total_chars // self.CHARS_PER_TOKEN

        return InjectedContext(sections=sections, token_estimate=token_estimate)

    def _load_section(self, doc_section: DocSection) -> str | None:
        filename, header = self.SECTION_MAP.get(doc_section, (None, None))
        if not filename:
            return None

        filepath = self.root / filename
        if not filepath.exists():
            return None

        full_text = filepath.read_text(encoding="utf-8")

        if header is None:
            # Full file — for /update-doc, strip to headers only to save tokens
            return self._diff_summary(full_text)

        return self._extract_section(full_text, header)

    def _extract_section(self, text: str, header: str) -> str:
        """
        Extract a single ## section from a markdown file.
        Returns everything from the header until the next ## heading.
        """
        pattern = re.compile(
            rf"^({re.escape(header)}.*?)(?=^##|\Z)",
            re.MULTILINE | re.DOTALL | re.IGNORECASE,
        )
        match = pattern.search(text)
        return match.group(1).strip() if match else ""

    def _diff_summary(self, text: str) -> str:
        """
        For full-doc loads (/update-doc), extract only heading lines
        + first sentence of each section to minimise tokens while
        preserving enough signal for drift detection.
        """
        lines = text.splitlines()
        summary_lines = []
        for i, line in enumerate(lines):
            if line.startswith("#"):
                summary_lines.append(line)
            elif summary_lines and lines[i - 1].startswith("#"):
                # First content line after a heading
                summary_lines.append(line[:200])  # cap at 200 chars
        return "\n".join(summary_lines)
