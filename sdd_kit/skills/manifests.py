"""
Skill manifests — hardcoded for v1.
Each manifest declares:
  - which doc sections to inject into context (context_needs)
  - which agent loop steps to run
  - what outputs it produces
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class DocSection(str, Enum):
    # constitution.md sections (always partial-injected)
    CONSTITUTION_RULES   = "constitution:rules"
    CONSTITUTION_STACK   = "constitution:stack"
    CONSTITUTION_USERS   = "constitution:users"
    CONSTITUTION_FULL    = "constitution:full"

    # other docs — full file, loaded only when declared
    PRD                  = "prd:full"
    ARCHITECTURE         = "architecture:full"
    FEATURE_SPEC         = "feature_spec:full"
    TEST_PLAN            = "test_plan:full"
    CHANGELOG            = "changelog:full"


class LoopStep(str, Enum):
    ELICIT    = "elicit"     # ask user for info
    PLAN      = "plan"       # break work into tasks
    SCAFFOLD  = "scaffold"   # create / modify files
    BUILD     = "build"      # run install / compile
    TEST      = "test"       # run tests, retry on fail
    REPORT    = "report"     # checklist + next suggestions


@dataclass
class SkillManifest:
    name: str
    description: str
    # Ordered doc sections injected into context — minimum needed
    context_needs: list[DocSection]
    # Agent loop steps this skill runs
    loop_steps: list[LoopStep]
    # Docs this skill may write/update
    produces: list[str]
    # Max retry attempts in TEST step before surfacing to user
    max_retries: int = 3
    # Whether to elicit from user before starting (Phase 1 only)
    requires_elicitation: bool = False


# ─────────────────────────────────────────────
# PHASE 1: Project initialisation (runs once)
# ─────────────────────────────────────────────

INIT = SkillManifest(
    name="/init",
    description="Bootstrap a new project: Q&A → all SDD docs → scaffold → build → test",
    context_needs=[
        # nothing pre-exists — context is built FROM elicitation answers
    ],
    loop_steps=[
        LoopStep.ELICIT,
        LoopStep.PLAN,
        LoopStep.SCAFFOLD,
        LoopStep.BUILD,
        LoopStep.TEST,
        LoopStep.REPORT,
    ],
    produces=[
        "docs/constitution.md",
        "docs/PRD.md",
        "docs/ARCHITECTURE.md",
        "docs/FEATURE_SPEC_MVP.md",
        "infra/docker-compose.yml",
        "infra/scripts/init-db.sql",
        ".env.example",
    ],
    requires_elicitation=True,
    max_retries=3,
)

# ─────────────────────────────────────────────
# PHASE 2: On-demand skills
# Each reads only what it needs — no full reload
# Every skill ends with scaffold→build→test→report
# ─────────────────────────────────────────────

PLAN = SkillManifest(
    name="/plan",
    description="Plan mode — produce a checklist for the requested work. No code changes.",
    context_needs=[
        DocSection.CONSTITUTION_RULES,
        DocSection.CONSTITUTION_STACK,
        DocSection.ARCHITECTURE,
        DocSection.FEATURE_SPEC,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.REPORT,
    ],
    produces=[
        "docs/PLAN.md",
    ],
    max_retries=1,
)

UX = SkillManifest(
    name="/ux",
    description="Design a feature end-to-end: architecture, feature spec, UI/UX, components. Produces specs, not code.",
    context_needs=[
        DocSection.CONSTITUTION_RULES,
        DocSection.CONSTITUTION_STACK,
        DocSection.CONSTITUTION_USERS,
        DocSection.ARCHITECTURE,
        DocSection.FEATURE_SPEC,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.SCAFFOLD,
        LoopStep.REPORT,
    ],
    produces=[
        "docs/ARCHITECTURE.md",       # updated
        "docs/FEATURE_SPEC_MVP.md",   # updated
        "docs/UX_SPEC.md",
        "docs/UI_COMPONENTS.md",
    ],
    max_retries=2,
)

BUILD = SkillManifest(
    name="/build",
    description="Implement a feature from spec. Reads architecture + feature spec.",
    context_needs=[
        DocSection.CONSTITUTION_STACK,
        DocSection.ARCHITECTURE,
        DocSection.FEATURE_SPEC,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.SCAFFOLD,
        LoopStep.BUILD,
        LoopStep.TEST,
        LoopStep.REPORT,
    ],
    produces=[],  # produces code files, not docs
    max_retries=5,  # more retries — code failures are expected
)

TEST = SkillManifest(
    name="/test",
    description="Run, fix, and expand tests. Only needs feature spec — not architecture.",
    context_needs=[
        DocSection.FEATURE_SPEC,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.SCAFFOLD,   # writes missing test files
        LoopStep.BUILD,
        LoopStep.TEST,
        LoopStep.REPORT,
    ],
    produces=[
        "docs/TEST_PLAN.md",
    ],
    max_retries=5,
)

REFACTOR = SkillManifest(
    name="/refactor",
    description="Clean up code while staying aligned with architecture decisions.",
    context_needs=[
        DocSection.CONSTITUTION_RULES,
        DocSection.ARCHITECTURE,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.SCAFFOLD,
        LoopStep.BUILD,
        LoopStep.TEST,
        LoopStep.REPORT,
    ],
    produces=[],
    max_retries=3,
)

REVIEW = SkillManifest(
    name="/review",
    description="Review code against the SDD spec. Surfaces drift and violations.",
    context_needs=[
        DocSection.CONSTITUTION_RULES,
        DocSection.ARCHITECTURE,
        DocSection.FEATURE_SPEC,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.REPORT,   # review = no scaffold/build, just analysis
    ],
    produces=[
        "docs/REVIEW.md",
    ],
    max_retries=1,
)

UPDATE_DOC = SkillManifest(
    name="/update-doc",
    description="Detect drift between code and SDD docs, then update docs to match reality.",
    context_needs=[
        # reads all docs but via diff — see ContextSelector
        DocSection.CONSTITUTION_FULL,
        DocSection.PRD,
        DocSection.ARCHITECTURE,
        DocSection.FEATURE_SPEC,
        DocSection.CHANGELOG,
    ],
    loop_steps=[
        LoopStep.PLAN,
        LoopStep.SCAFFOLD,   # rewrites doc sections
        LoopStep.REPORT,
    ],
    produces=[
        "docs/constitution.md",
        "docs/ARCHITECTURE.md",
        "docs/FEATURE_SPEC_MVP.md",
        "docs/CHANGELOG.md",
    ],
    max_retries=1,
)

# ─────────────────────────────────────────────
# Registry — lookup by slash command name
# ─────────────────────────────────────────────

REGISTRY: dict[str, SkillManifest] = {
    m.name: m for m in [
        INIT,
        PLAN,
        UX,
        BUILD,
        TEST,
        REFACTOR,
        REVIEW,
        UPDATE_DOC,
    ]
}


def get(command: str) -> Optional[SkillManifest]:
    """Look up a skill manifest by slash command, e.g. get('/test')"""
    return REGISTRY.get(command)


def list_skills() -> list[SkillManifest]:
    return list(REGISTRY.values())
