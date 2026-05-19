# SDD Kit — Spec-Driven Development

> Tell the AI what you want to build. It writes the spec, scaffolds the code, runs tests, and reports back. You just review.

SDD Kit is a VS Code chat participant (`@sdd`) that turns a one-sentence idea into a working project — by writing the **spec first** and then generating code from it.

It uses your existing **GitHub Copilot** subscription. No extra API keys, no extra bills.

---

## Install (2 steps)

```bash
pip install sdd-kit
sdd install-extension
```

That's it. Reload VS Code and you'll see `@sdd` in the chat panel.

**Requirements**
- Python 3.10+ (for `pip install sdd-kit`)
- VS Code 1.85+ with the **GitHub Copilot** extension signed in
- The `code` (or `cursor`) CLI on your PATH
  *VS Code → Cmd+Shift+P → "Shell Command: Install 'code' command in PATH"*

> **Why pip?** The CLI bundles a copy of the `.vsix` and installs it via the `code` CLI, so you don't have to download anything manually or trust a Marketplace upload.

---

## Quickstart — 60 seconds

1. Open any folder in VS Code.
2. Open the chat panel (Ctrl/Cmd+Alt+I).
3. Type:
   ```
   @sdd /init a sales analytics dashboard
   ```
4. Answer 6–8 questions about stack, users, MVP scope.
5. SDD Kit writes 4 spec docs into `docs/` and scaffolds the project.

That's the loop. From here, ask `@sdd` to do anything else with the slash commands below.

---

## The commands — what they do and when to use them

`@sdd` exposes 8 slash commands. **`/init` runs once per project. The others are tools you reach for whenever you need them.**

### `/init` — Start a new project

> Use once, at the beginning. Turns "an idea" into "a real folder with spec docs and starter code".

```
@sdd /init a CRM for solo lawyers
```

Asks you: stack? who uses it? what's in the MVP? what's out of scope?
Writes: `docs/constitution.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/FEATURE_SPEC_MVP.md`, plus initial code.

### `/plan` — Get a checklist before doing the work

> Use when you want SDD to think before it touches code. Outputs `docs/PLAN.md` with goal, assumptions, numbered checklist, risks, and acceptance criteria. **Writes no code.**

```
@sdd /plan migrate auth from sessions to JWT
```

Read the plan, edit it if you want, then run `/build` to execute it.

### `/ux` — Design a feature end-to-end

> Use when you want to add or rework a feature *before* writing code. Updates the architecture & feature docs, and produces UX spec + component catalog. **Writes no code yet — `/build` does that.**
>
> Outputs (updating existing files in place if they exist):
> - `docs/ARCHITECTURE.md` — new components, endpoints, data-model changes
> - `docs/FEATURE_SPEC_MVP.md` — user stories, acceptance criteria
> - `docs/UX_SPEC.md` — user flows, screen inventory, navigation, accessibility
> - `docs/UI_COMPONENTS.md` — design tokens, component catalog

```
@sdd /ux add invoice export to PDF
```

### `/build` — Implement code from the spec

> Use after `/ux`, or when a feature is in the spec but not built yet. Reads the spec, writes the code.

```
@sdd /build the invoice export feature
```

### `/test` — Write or fix tests

> Use after `/build`, or whenever tests are missing/red.

```
@sdd /test
```

### `/refactor` — Clean up code, staying aligned with the spec

> Use when the code works but is messy. SDD reads the architecture rules and refactors without breaking contracts.

```
@sdd /refactor the auth module
```

### `/review` — Audit code against the spec

> Use before merging or shipping. Outputs a `REVIEW.md` with drift, gaps, and risks.

```
@sdd /review
```

### `/update-doc` — Sync docs back to the code

> Use after manual code changes that diverged from the spec. SDD detects drift and rewrites the docs to match reality.

```
@sdd /update-doc
```

---

## Why "spec-driven"?

Most AI coding tools jump straight to code, and the code becomes the only source of truth. That works for snippets, not for projects you have to maintain.

SDD Kit keeps a **spec** (`docs/constitution.md` + friends) as the source of truth:

- Every `/build`, `/refactor`, `/test` reads only the spec sections it needs (not the whole codebase) — so it stays fast and on-topic.
- Every `/review` compares code against the spec — so drift is visible.
- Every `/update-doc` resyncs the spec — so the docs never go stale.

In short: the spec is the contract, the code is one implementation, and SDD keeps them in sync.

---

## Project layout after `/init`

```
my-project/
├── docs/
│   ├── constitution.md       # name, stack, users, rules, MVP scope
│   ├── PRD.md                # problem, goals, success metrics
│   ├── ARCHITECTURE.md       # folders, components, API, data model
│   └── FEATURE_SPEC_MVP.md   # feature-by-feature breakdown
└── …scaffolded code…
```

Additional docs created on-demand by other skills:

```
docs/
├── PLAN.md             # ← /plan
├── UX_SPEC.md          # ← /ux
├── UI_COMPONENTS.md    # ← /ux
├── TEST_PLAN.md        # ← /test
└── REVIEW.md           # ← /review
```

---

## Troubleshooting

**"No language model available"** — Install GitHub Copilot and sign in (GitHub icon in the Activity Bar). SDD Kit will use whichever model Copilot offers — Claude, GPT-4o, or others.

**`sdd install-extension` says "couldn't find code CLI"** — In VS Code: Cmd+Shift+P → "Shell Command: Install 'code' command in PATH". Same with Cursor.

**`@sdd` doesn't appear in chat** — Reload VS Code (Cmd+Shift+P → "Developer: Reload Window") after installing the extension.

---

## License

Apache-2.0.
