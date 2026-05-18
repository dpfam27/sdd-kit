# SDD Kit — Spec-Driven Development

> Describe what you want to build. The AI writes the spec, scaffolds the code, tests it, and reports back. You only review and refine.

## Install

```bash
# 1) Install the CLI
python3 -m pip install -U sdd-kit

# 2) (Optional) Install the VS Code extension (no API key required)
sdd install-extension
```

That's it.

Notes:

- The VS Code extension install requires the VS Code CLI (`code`) to be on your PATH.
- `sdd install-extension` downloads the latest `.vsix` from GitHub Releases and runs `code --install-extension`.

### Build & package (maintainers)

This repo prefers `uv` for reproducible Python builds.

```bash
# Build Python artifacts
cd ~/sdd-kit
uv run -m pip install -U pip setuptools wheel build
uv run -m build
```

```bash
# Package VS Code extension (.vsix)
cd ~/sdd-kit/vscode-extension
npm install
npx --yes @vscode/vsce package
```

## Quick start

### Option A — Terminal
```bash
sdd init
# Answer a few questions → AI builds everything silently
```

### Option B — VS Code chat
```
@sdd /init a sales analytics dashboard for e-commerce teams
```
Answer the Q&A in the terminal that opens → done.

---

## How it works

### Phase 1 — Project bootstrap (once)

```
You:  sdd init
      → answer ~8 questions (name, stack, users, MVP scope)

AI:   writes docs/constitution.md   ← master spec, anchors everything
      writes docs/PRD.md
      writes docs/ARCHITECTURE.md
      writes docs/FEATURE_SPEC_MVP.md
      scaffolds code structure
      runs build + tests
      retries until tests pass
      reports: "✓ Done — here's what was built + suggested next steps"
```

### Phase 2 — On-demand skills (anytime)

Each skill reads **only the spec sections it needs** (token-efficient), then runs its own scaffold → build → test → report loop.

| Command | What it does | Spec sections loaded |
|---|---|---|
| `sdd design` | Redesign or add a feature | constitution:rules + architecture |
| `sdd build` | Implement a feature from spec | constitution:stack + architecture + feature_spec |
| `sdd test` | Run + auto-fix tests | feature_spec only |
| `sdd refactor` | Clean up code | constitution:rules + architecture |
| `sdd review` | Review code vs spec | constitution:rules + architecture + feature_spec |
| `sdd update-doc` | Sync spec docs to current code | all docs (headers only for efficiency) |

---

## VS Code

After `setup.sh`, open VS Code and use the `@sdd` chat participant:

```
@sdd /init  a task management app for construction teams
@sdd /design  add a Gantt chart view
@sdd /test
@sdd /review
```

Open the spec panel: `Cmd+Shift+P` → **SDD Kit: Open Spec Panel**

---

## Project structure

After `/init`, your project looks like:

```
my-project/
├── docs/
│   ├── constitution.md      ← master spec (AI always reads this)
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── FEATURE_SPEC_MVP.md
├── [your code here]
└── ...
```

---

## Requirements

- Python 3.10+
- `ANTHROPIC_API_KEY` environment variable
- VS Code 1.85+ (for chat extension, optional)
- Node.js 20+ (for VS Code extension build, optional)

## Configuration

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # required
```

---

## Install for other users (from built artifacts)

If you’ve already built the artifacts (`.whl` for the Python CLI and `.vsix` for the VS Code extension), another user can install them locally.

### 1) Install the Python CLI (wheel)

```bash
# from the folder where you placed the wheel
python3 -m pip install ./sdd_kit-0.1.0-py3-none-any.whl

# verify
sdd --help
```

### 2) Install the VS Code extension (VSIX)

```bash
# from the folder where you placed the VSIX
code --install-extension ./sdd-kit-0.1.0.vsix
```

Tip: you can uninstall later with:

```bash
code --uninstall-extension your-org.sdd-kit
```

---

## SDD = Spec-Driven Development

The spec docs are not just documentation — they are the **source of truth the AI builds from**. Every skill reads the relevant spec sections before doing anything. This means:

- The AI never goes off-spec
- Skills never load more context than needed (keeps prompts lean)
- Docs and code stay in sync via `/update-doc`
