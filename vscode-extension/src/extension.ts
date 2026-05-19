import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// ─── types ────────────────────────────────────────────────────────

interface SkillManifest {
  name: string;
  context_needs: string[];
  loop_steps: string[];
}

type DocRole =
  | "constitution"
  | "prd"
  | "architecture"
  | "feature_spec"
  | "ux_spec"
  | "ui_components"
  | "plan"
  | "test_plan"
  | "review"
  | "changelog";

type SpecFileMap = Partial<Record<DocRole, string>>;

interface ProjectInfo {
  workspaceRoot: string;
  specs: SpecFileMap;
}

// Filename → role. Matched case-insensitively.
const FILENAME_TO_ROLE: Array<{ re: RegExp; role: DocRole }> = [
  { re: /^constitution\.md$/i, role: "constitution" },
  { re: /^PRD\.md$/i, role: "prd" },
  { re: /^ARCHITECTURE\.md$/i, role: "architecture" },
  { re: /^FEATURE[_-]?SPEC.*\.md$/i, role: "feature_spec" },
  { re: /^UX[_-]?SPEC\.md$/i, role: "ux_spec" },
  { re: /^UI[_-]?COMPONENTS?\.md$/i, role: "ui_components" },
  { re: /^PLAN\.md$/i, role: "plan" },
  { re: /^TEST[_-]?PLAN\.md$/i, role: "test_plan" },
  { re: /^REVIEW\.md$/i, role: "review" },
  { re: /^CHANGELOG\.md$/i, role: "changelog" },
];

// Markdown headers that typically appear in each role's content.
// Need ≥2 of a role's signatures to claim content-based match.
const CONTENT_SIGNATURES: Record<DocRole, RegExp[]> = {
  constitution: [/##\s*stack/i, /##\s*rules?/i, /##\s*mvp/i, /##\s*users?/i, /##\s*scope/i],
  prd: [/##\s*problem/i, /##\s*goals?/i, /##\s*(success\s*)?metrics?/i, /##\s*features?/i],
  architecture: [/##\s*folder\s*structure/i, /##\s*components?/i, /##\s*api\b/i, /##\s*data\s*model/i],
  feature_spec: [/##\s*features?/i, /##\s*user\s*stor(y|ies)/i, /##\s*acceptance/i],
  ux_spec: [/##\s*user\s*flows?/i, /##\s*screens?/i, /##\s*navigation/i, /##\s*accessibility/i],
  ui_components: [/##\s*design\s*tokens?/i, /##\s*components?/i, /##\s*colou?rs?/i, /##\s*typography/i],
  plan: [/##\s*steps?/i, /##\s*(acceptance|definition\s*of\s*done)/i, /\[ \]/],
  test_plan: [/##\s*tests?/i, /##\s*coverage/i, /##\s*scenarios?/i],
  review: [/##\s*findings?/i, /##\s*drift/i, /##\s*recommendations?/i],
  changelog: [/##\s*\[?\d+\.\d+/, /##\s*(added|changed|fixed|removed)/i, /##\s*unreleased/i],
};


// ─── activation ───────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant(
    "sdd-kit.agent",
    handleChatRequest
  );
  participant.iconPath = new vscode.ThemeIcon("book");

  context.subscriptions.push(
    vscode.commands.registerCommand("sdd-kit.openPanel", () => {
      SddPanel.createOrShow(context.extensionUri);
    }),
    vscode.commands.registerCommand("sdd-kit.showDocs", () => {
      openSpecDocs();
    }),
    participant
  );
}

// ─── chat participant handler ──────────────────────────────────────

async function handleChatRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const command = request.command;
  const userText = request.prompt.trim();
  // Use whatever model the user has selected in the chat dropdown.
  // VS Code provides this on the request object as of the Chat API GA.
  const model: vscode.LanguageModelChat | undefined = request.model;

  if (!command) {
    stream.markdown(
      "**SDD Kit** — Spec-Driven Development\n\n" +
      "Available commands:\n" +
      "- `/init <description>` — bootstrap a new project\n" +
      "- `/plan` — produce a checklist plan (no code changes)\n" +
      "- `/ux` — design a feature: architecture, feature spec, UI/UX, components\n" +
      "- `/build` — implement from spec\n" +
      "- `/test` — run + fix tests\n" +
      "- `/refactor` — clean up code\n" +
      "- `/review` — review vs spec\n" +
      "- `/update-doc` — sync docs to code\n"
    );
    return;
  }

  if (command === "init") {
    if (!userText) {
      stream.markdown("Tell me what you want to build in one sentence:\n\n`/init a sales analytics dashboard`");
      return;
    }
    await runInit(userText, stream, token, model);
    return;
  }

  const project = await getProjectInfo();
  if (!project) {
    stream.markdown("⚠️ No SDD project found in this workspace. Run `/init <description>` first.");
    return;
  }

  await runSkill(command, userText, project, stream, token, model);
}

// ─── /init flow ───────────────────────────────────────────────────

async function runInit(
  description: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  requestModel: vscode.LanguageModelChat | undefined
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown("⚠️ Open a workspace folder first.");
    return;
  }

  stream.markdown(`**Starting /init** for: *"${description}"*\n\n`);

  // Use the model the user selected in the chat dropdown.
  // Fall back to any available model only if request.model is missing (older VS Code).
  const model = requestModel ?? (await pickChatModel());
  if (!model) {
    stream.markdown(
      "⚠️ No language model available.\n\n" +
      "Make sure GitHub Copilot (or another Copilot-compatible provider) is signed in:\n" +
      "1. Install the GitHub Copilot extension\n" +
      "2. Sign in via the GitHub icon in the Activity Bar\n" +
      "3. Pick a model in the chat dropdown, then re-run `@sdd /init <description>`"
    );
    return;
  }

  stream.progress("Generating elicitation questions...");

  const qPrompt = [
    vscode.LanguageModelChatMessage.User(
      `User wants to build: "${description}"\n\n` +
      `Generate 6-8 essential questions to ask before scaffolding this project. ` +
      `Return ONLY a JSON array of question strings, no markdown.`
    )
  ];

  let questions: string[] = [];
  try {
    const qResponse = await model.sendRequest(qPrompt, {}, token);
    let qText = "";
    for await (const chunk of qResponse.text) {
      qText += chunk;
    }
    questions = JSON.parse(qText.trim());
  } catch (err) {
    stream.markdown(`⚠️ Failed to generate questions: ${err}`);
    return;
  }

  // Step 2: Ask user via input boxes
  stream.markdown("**Answer these questions:**\n\n");
  const answers: Record<string, string> = { project_description: description };

  for (const q of questions) {
    const answer = await vscode.window.showInputBox({
      prompt: q,
      placeHolder: "Type your answer...",
    });
    if (!answer) {
      stream.markdown("\n❌ Cancelled.");
      return;
    }
    answers[q] = answer;
    stream.markdown(`- ${q}\n  → *${answer}*\n`);
  }

  // Step 3: Generate all spec docs
  stream.progress("Generating spec docs...");

  const genPrompt = [
    vscode.LanguageModelChatMessage.User(
      `Generate a complete SDD (Spec-Driven Development) document set for this project.\n\n` +
      `User answers:\n${JSON.stringify(answers, null, 2)}\n\n` +
      `Generate 4 markdown files:\n` +
      `1. constitution.md — master spec with project name, stack, users, rules, MVP scope\n` +
      `2. PRD.md — problem, goals, features, success metrics\n` +
      `3. ARCHITECTURE.md — folder structure, components, API contracts, data models\n` +
      `4. FEATURE_SPEC_MVP.md — detailed feature breakdown for MVP\n\n` +
      `Output format: <<<FILE path/to/file.md>>>\\n<content>\\n<<<END>>> for each file.`
    )
  ];

  // Write spec docs directly into the workspace the user opened — no extra
  // sub-folder. The workspace IS the project. If existing spec files are
  // already present elsewhere (e.g. `specs/` instead of `docs/`), AI writes
  // get redirected by filename via resolveWritePath.
  const existingSpecs = await discoverSpecFiles(workspaceRoot);

  try {
    const genResponse = await model.sendRequest(genPrompt, {}, token);
    let fullText = "";
    for await (const chunk of genResponse.text) {
      fullText += chunk;
    }

    // Parse and write files
    const fileRegex = /<<<FILE (.+?)>>>\n([\s\S]+?)<<<END>>>/g;
    let match;
    const createdFiles: string[] = [];

    while ((match = fileRegex.exec(fullText)) !== null) {
      const aiPath = match[1].trim();
      const content = match[2];
      const fullPath = resolveWritePath(workspaceRoot, existingSpecs, aiPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
      createdFiles.push(path.relative(workspaceRoot, fullPath));
    }

    stream.markdown("\n✅ **Spec docs created:**\n");
    for (const f of createdFiles) {
      stream.markdown(`- ${f}\n`);
    }

    // Step 4: Suggest next actions
    stream.markdown(
      `\n**Next steps:**\n` +
      `1. Review the spec docs above\n` +
      `2. Run \`@sdd /plan <task>\` to get a checklist before coding\n` +
      `3. Run \`@sdd /build\` to scaffold code from the spec\n`
    );

    // Find the new constitution to open as a quick way in.
    const refreshed = await discoverSpecFiles(workspaceRoot);
    const openTarget = refreshed.constitution;
    if (openTarget) stream.button({
      command: "vscode.open",
      title: "Open constitution.md",
      arguments: [vscode.Uri.file(openTarget)],
    });

  } catch (err) {
    stream.markdown(`\n❌ Error: ${err}`);
  }
}

// ─── Phase 2 skill runner ──────────────────────────────────────────

async function runSkill(
  skillName: string,
  userPrompt: string,
  project: ProjectInfo,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  requestModel: vscode.LanguageModelChat | undefined
): Promise<void> {
  stream.progress(`Running /${skillName}...`);

  // Load skill manifest to know what context to inject
  const manifest = getSkillManifest(skillName);
  if (!manifest) {
    stream.markdown(`⚠️ Unknown skill: /${skillName}`);
    return;
  }

  // Load only the spec sections this skill needs, from wherever the user keeps them
  const context = loadContext(project, manifest.context_needs);

  // Use the model the user picked in the chat dropdown.
  const model = requestModel ?? (await pickChatModel());
  if (!model) {
    stream.markdown(
      "⚠️ No language model available. Pick a model in the chat dropdown (or sign in to GitHub Copilot) and try again."
    );
    return;
  }

  // Tell the AI which roles have existing files and where they live, so it
  // can output paths that round-trip back to the user's chosen layout.
  const existingPathsList = Object.entries(project.specs)
    .map(([role, p]) => `  - ${role}: ${path.relative(project.workspaceRoot, p!)}`)
    .join("\n");

  const systemPrompt =
    `You are sdd-kit, a Spec-Driven Development agent.\n` +
    `Skill: /${skillName} — ${manifest.name}\n` +
    `Project root: ${project.workspaceRoot}\n` +
    (existingPathsList
      ? `Existing spec files (reuse these paths when updating; the runtime will redirect by filename if you guess wrong):\n${existingPathsList}\n\n`
      : "\n") +
    `Context (spec sections loaded):\n${context}\n\n` +
    `User request: ${userPrompt || "Run this skill"}\n\n` +
    `Your task: ${getSkillTask(skillName)}\n\n` +
    `Output format rules (STRICT):\n` +
    `1. Every file the task marks REQUIRED must appear as a <<<FILE>>> block — even if unchanged.\n` +
    `2. Each file block: <<<FILE path/to/file>>>\\n<full file content>\\n<<<END>>>\n` +
    `3. After ALL file blocks, output exactly one summary block:\n` +
    `   <<<SUMMARY>>>\\n- What was done\\n<<<NEXT>>>\\n1. Suggested next step\\n<<<END>>>\n` +
    `4. Never output file content outside of <<<FILE>>> blocks.`;

  const messages = [vscode.LanguageModelChatMessage.User(systemPrompt)];

  try {
    stream.progress(`Thinking…`);
    const response = await model.sendRequest(messages, {}, token);
    let fullText = "";
    // Don't stream raw chunks — the AI emits <<<FILE>>>…<<<END>>> markers
    // wrapped around the entire file contents and dumping that into chat
    // is unreadable. We buffer everything, then render a clean summary.
    for await (const chunk of response.text) {
      fullText += chunk;
    }

    // Parse and write files. Redirect each AI-supplied path by filename to
    // any existing spec file we discovered, so user-chosen folder layouts
    // (e.g. `specs/` instead of `docs/`) are preserved.
    const fileRegex = /<<<FILE (.+?)>>>\n([\s\S]+?)<<<END>>>/g;
    let match;
    const createdFiles: string[] = [];

    while ((match = fileRegex.exec(fullText)) !== null) {
      const aiPath = match[1].trim();
      const content = match[2];
      const fullPath = resolveWritePath(project.workspaceRoot, project.specs, aiPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
      createdFiles.push(path.relative(project.workspaceRoot, fullPath));
    }

    // Pull out the optional <<<SUMMARY>>>…<<<NEXT>>>…<<<END>>> block.
    const summaryMatch = fullText.match(
      /<<<SUMMARY>>>\s*([\s\S]*?)\s*<<<NEXT>>>\s*([\s\S]*?)\s*<<<END>>>/,
    );
    const summary = summaryMatch?.[1].trim() ?? "";
    const nextSteps = summaryMatch?.[2].trim() ?? "";

    // Whatever the AI said outside file blocks and the summary block is its
    // human-readable narration — show that as the chat response.
    const narration = fullText
      .replace(/<<<FILE [\s\S]+?<<<END>>>/g, "")
      .replace(/<<<SUMMARY>>>[\s\S]+?<<<END>>>/g, "")
      .trim();

    if (narration) {
      stream.markdown(narration + "\n");
    }

    if (createdFiles.length > 0) {
      stream.markdown(`\n**Files written**\n`);
      for (const f of createdFiles) {
        stream.markdown(`- \`${f}\`\n`);
      }
      // Offer a one-click "Open" for the first file.
      const firstFull = path.join(project.workspaceRoot, createdFiles[0]);
      stream.button({
        command: "vscode.open",
        title: `Open ${createdFiles[0]}`,
        arguments: [vscode.Uri.file(firstFull)],
      });
    }

    if (summary) {
      stream.markdown(`\n**Summary**\n${summary}\n`);
    }
    if (nextSteps) {
      stream.markdown(`\n**Next**\n${nextSteps}\n`);
    }

    if (!narration && createdFiles.length === 0 && !summary) {
      // AI didn't follow the format at all — show its raw reply so the user
      // can see what happened.
      stream.markdown(fullText);
    }
  } catch (err) {
    stream.markdown(`\n❌ Error: ${err}`);
  }
}

// ─── helpers ──────────────────────────────────────────────────────

async function pickChatModel(): Promise<vscode.LanguageModelChat | null> {
  // Try preferred families in priority order. VS Code Copilot exposes Claude under
  // a few different family slugs depending on the Copilot version, so we try each.
  const preferred = [
    "claude-3-5-sonnet",
    "claude-3.5-sonnet",
    "claude-sonnet-4",
    "claude-sonnet-4.5",
    "claude-opus-4",
    "gpt-4o",
    "gpt-4",
    "gpt-4-turbo",
  ];
  for (const family of preferred) {
    const models = await vscode.lm.selectChatModels({ family });
    if (models.length > 0) return models[0];
  }
  // Fallback: any chat model the user has access to.
  const all = await vscode.lm.selectChatModels();
  return all[0] ?? null;
}

function getSkillManifest(skillName: string): SkillManifest | null {
  const manifests: Record<string, SkillManifest> = {
    plan: {
      name: "Plan mode — output a checklist, no code changes",
      context_needs: ["constitution:rules", "constitution:stack", "architecture", "feature_spec"],
      loop_steps: ["plan", "report"],
    },
    ux: {
      name: "Design a feature — architecture, feature spec, UI/UX, components",
      context_needs: ["constitution:rules", "constitution:stack", "constitution:users", "architecture", "feature_spec"],
      loop_steps: ["plan", "scaffold", "report"],
    },
    build: {
      name: "Implement a feature from spec",
      context_needs: ["constitution:stack", "architecture", "feature_spec"],
      loop_steps: ["plan", "scaffold", "build", "test", "report"],
    },
    test: {
      name: "Run and fix tests",
      context_needs: ["feature_spec"],
      loop_steps: ["plan", "scaffold", "build", "test", "report"],
    },
    refactor: {
      name: "Clean up code",
      context_needs: ["constitution:rules", "architecture"],
      loop_steps: ["plan", "scaffold", "build", "test", "report"],
    },
    review: {
      name: "Review code vs spec",
      context_needs: ["constitution:rules", "architecture", "feature_spec"],
      loop_steps: ["plan", "report"],
    },
    "update-doc": {
      name: "Sync docs to code",
      context_needs: ["constitution:full", "prd", "architecture", "feature_spec"],
      loop_steps: ["plan", "scaffold", "report"],
    },
  };
  return manifests[skillName] || null;
}

function getSkillTask(skillName: string): string {
  const tasks: Record<string, string> = {
    plan: "Read the request and produce a step-by-step PLAN.md checklist. DO NOT create or modify any code files. Output ONLY one file: <<<FILE docs/PLAN.md>>> with: (1) Goal — one line, (2) Assumptions — bullets, (3) Steps — numbered checklist of [ ] items grouped by phase, (4) Risks — bullets, (5) Acceptance — checklist for definition of done. Be specific: each step names the file(s) it touches.",
    ux: "Design the UI/UX for the requested feature. Output exactly TWO files: " +
        "<<<FILE docs/UX_SPEC.md>>> — (1) User flows: numbered steps per persona, (2) Screen inventory: one heading per screen with purpose/key elements/primary CTA/empty+error states, (3) Navigation map, (4) Accessibility requirements. " +
        "<<<FILE docs/UI_COMPONENTS.md>>> — (1) Design tokens: colors, spacing, radii, type scale with concrete values, (2) Component catalog: name/props/states/used-on-screens. " +
        "Do NOT modify ARCHITECTURE.md or FEATURE_SPEC_MVP.md. Do NOT write any code — /build implements the design.",
    build: "Implement the feature by creating/modifying code files. Follow the architecture spec. Output all modified files.",
    test: "Write or fix tests for the current codebase. Output test files.",
    refactor: "Clean up the code while staying aligned with the architecture. Output refactored files.",
    review: "Review the codebase against the spec. Output a REVIEW.md with findings.",
    "update-doc": "Detect what changed in the code vs the spec docs. Update the spec docs to match reality. Output updated doc files.",
  };
  return tasks[skillName] || "Execute the skill task.";
}

function loadContext(project: ProjectInfo, needs: string[]): string {
  const parts: string[] = [];

  // Map each "need" slug to a discovered role. The "constitution:rules" /
  // "constitution:stack" / "constitution:users" / "constitution:full" needs
  // all point to the same constitution.md but ask for different sections.
  const needToRole: Record<string, DocRole> = {
    "constitution:rules": "constitution",
    "constitution:stack": "constitution",
    "constitution:users": "constitution",
    "constitution:full": "constitution",
    prd: "prd",
    architecture: "architecture",
    feature_spec: "feature_spec",
  };

  for (const need of needs) {
    const role = needToRole[need];
    if (!role) continue;
    const fullPath = project.specs[role];
    if (!fullPath || !fs.existsSync(fullPath)) continue;

    let content = fs.readFileSync(fullPath, "utf-8");

    // For constitution sub-sections, extract only the relevant section.
    if (need.startsWith("constitution:") && need !== "constitution:full") {
      const section = need.split(":")[1];
      const regex = new RegExp(`## ${section}[\\s\\S]+?(?=\\n##|$)`, "i");
      const match = content.match(regex);
      content = match ? match[0] : "";
    }

    if (content) {
      parts.push(`<!-- ${need} (from ${path.relative(project.workspaceRoot, fullPath)}) -->\n${content}`);
    }
  }

  return parts.join("\n\n");
}


async function getProjectInfo(): Promise<ProjectInfo | null> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const workspaceRoot = folders[0].uri.fsPath;
  const specs = await discoverSpecFiles(workspaceRoot);
  // A workspace counts as an SDD project if we found at least a constitution
  // (the master spec) — every other doc is optional and skill-specific.
  if (!specs.constitution) return null;
  return { workspaceRoot, specs };
}

/**
 * Scan the workspace for spec markdown files and map each role → best file path.
 * Filename match (case-insensitive) scores higher than content-signature match.
 * Among ties, shallowest path wins, so nested sub-projects don't override the top-level one.
 */
async function discoverSpecFiles(workspaceRoot: string): Promise<SpecFileMap> {
  const uris = await vscode.workspace.findFiles(
    "**/*.md",
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.venv/**,**/__pycache__/**}",
    500,
  );

  type Candidate = { path: string; score: number; depth: number };
  const byRole: Record<string, Candidate[]> = {};

  for (const uri of uris) {
    const filePath = uri.fsPath;
    const filename = path.basename(filePath);
    const depth = path.relative(workspaceRoot, filePath).split(path.sep).length;

    let nameRole: DocRole | null = null;
    for (const { re, role } of FILENAME_TO_ROLE) {
      if (re.test(filename)) {
        nameRole = role;
        break;
      }
    }

    if (nameRole) {
      (byRole[nameRole] ||= []).push({ path: filePath, score: 10, depth });
      continue;
    }

    // Content-based fallback — only read the file if filename didn't match anything.
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8").slice(0, 16384); // first 16KB is plenty for headers
    } catch {
      continue;
    }

    for (const [role, sigs] of Object.entries(CONTENT_SIGNATURES) as [DocRole, RegExp[]][]) {
      const matched = sigs.filter((s) => s.test(content)).length;
      if (matched >= 2) {
        (byRole[role] ||= []).push({ path: filePath, score: 5 + matched, depth });
      }
    }
  }

  const result: SpecFileMap = {};
  for (const [role, cands] of Object.entries(byRole)) {
    cands.sort((a, b) => b.score - a.score || a.depth - b.depth);
    result[role as DocRole] = cands[0].path;
  }
  return result;
}

/**
 * Decide where to actually write a file the AI asked to create or update.
 *
 *  1. If a file with that filename already exists in the spec map, overwrite it
 *     in place — so a user who moved `docs/ARCHITECTURE.md` to `specs/` keeps
 *     their layout instead of getting a duplicate at `docs/ARCHITECTURE.md`.
 *  2. If it's a brand-new spec file (e.g. PLAN.md on first /plan), cluster it
 *     next to the existing constitution so all spec docs stay together.
 *  3. Otherwise fall back to the AI-supplied path under the workspace root.
 */
function resolveWritePath(
  workspaceRoot: string,
  specs: SpecFileMap,
  aiPath: string,
): string {
  const filename = path.basename(aiPath);

  for (const existingPath of Object.values(specs)) {
    if (existingPath && path.basename(existingPath).toLowerCase() === filename.toLowerCase()) {
      return existingPath;
    }
  }

  if (specs.constitution) {
    return path.join(path.dirname(specs.constitution), filename);
  }

  return path.isAbsolute(aiPath) ? aiPath : path.join(workspaceRoot, aiPath);
}

async function openSpecDocs() {
  const project = await getProjectInfo();
  if (!project) {
    vscode.window.showInformationMessage("No SDD project found. Run /init first.");
    return;
  }
  const items = Object.entries(project.specs)
    .filter(([, p]) => !!p)
    .map(([role, p]) => ({
      label: path.basename(p!),
      description: `${role} — ${path.relative(project.workspaceRoot, p!)}`,
      path: p!,
    }));
  if (items.length === 0) {
    vscode.window.showInformationMessage("No spec markdown files found in this workspace.");
    return;
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Open a spec doc" });
  if (picked) vscode.window.showTextDocument(vscode.Uri.file(picked.path));
}

// ─── SDD panel (spec docs viewer) ─────────────────────────────────

class SddPanel {
  static currentPanel: SddPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (SddPanel.currentPanel) {
      SddPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "sddKit",
      "SDD Kit — Spec",
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    SddPanel.currentPanel = new SddPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = `<html><body style="padding:20px;font-family:var(--vscode-font-family)">Scanning workspace…</body></html>`;
    this._renderHtml();
    this._panel.onDidDispose(() => { SddPanel.currentPanel = undefined; });

    this._panel.webview.onDidReceiveMessage((msg: { command: string; path?: string; skill?: string }) => {
      if (msg.command === "openFile" && msg.path) {
        vscode.window.showTextDocument(vscode.Uri.file(msg.path));
      }
      if (msg.command === "runSkill" && msg.skill) {
        vscode.commands.executeCommand("workbench.action.chat.open", {
          query: `@sdd /${msg.skill}`,
        });
      }
    });
  }

  private async _renderHtml(): Promise<void> {
    this._panel.webview.html = await this._getHtml();
  }

  private async _getHtml(): Promise<string> {
    const project = await getProjectInfo();
    const docs = project ? this._loadDocs(project) : [];

    const docItems = docs.map((d) =>
      `<div class="doc-item" onclick="openFile('${d.path.replace(/\\/g, "\\\\")}')">
        <span class="doc-icon">📄</span>
        <span class="doc-name">${d.name}</span>
        <span class="doc-size">${d.size}</span>
      </div>`
    ).join("");

    const skills = [
      { cmd: "plan",       label: "/plan",       desc: "Checklist plan (no code)" },
      { cmd: "ux",         label: "/ux",         desc: "Design a feature (specs + UI)" },
      { cmd: "build",      label: "/build",      desc: "Implement from spec" },
      { cmd: "test",       label: "/test",       desc: "Run + fix tests" },
      { cmd: "refactor",   label: "/refactor",   desc: "Clean up code" },
      { cmd: "review",     label: "/review",     desc: "Review vs spec" },
      { cmd: "update-doc", label: "/update-doc", desc: "Sync docs to code" },
    ];

    const skillButtons = skills.map((s) =>
      `<button class="skill-btn" onclick="runSkill('${s.cmd}')">
        <strong>${s.label}</strong>
        <span>${s.desc}</span>
      </button>`
    ).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
  h2 { font-size: 14px; font-weight: 600; margin: 20px 0 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.08em; }
  .doc-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid var(--vscode-widget-border); margin-bottom: 6px; }
  .doc-item:hover { background: var(--vscode-list-hoverBackground); }
  .doc-name { flex: 1; font-size: 13px; }
  .doc-size { opacity: 0.4; font-size: 11px; }
  .skill-btn { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--vscode-widget-border); background: transparent; color: var(--vscode-foreground); cursor: pointer; margin-bottom: 6px; text-align: left; }
  .skill-btn:hover { background: var(--vscode-list-hoverBackground); }
  .skill-btn strong { font-size: 13px; color: var(--vscode-textLink-foreground); }
  .skill-btn span { font-size: 11px; opacity: 0.6; }
  .empty { opacity: 0.4; font-size: 13px; padding: 12px 0; }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .header h1 { font-size: 16px; margin: 0; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
</style>
</head>
<body>
<div class="header">
  <h1>SDD Kit</h1>
  <span class="badge">Spec-Driven Development</span>
</div>

<h2>Spec docs</h2>
${docItems || '<p class="empty">No spec docs found. Run /init to create a project.</p>'}

<h2>On-demand skills</h2>
${skillButtons}

<script>
  const vscode = acquireVsCodeApi();
  function openFile(p) { vscode.postMessage({ command: 'openFile', path: p }); }
  function runSkill(s) { vscode.postMessage({ command: 'runSkill', skill: s }); }
</script>
</body>
</html>`;
  }

  private _loadDocs(project: ProjectInfo): Array<{ name: string; path: string; size: string }> {
    const out: Array<{ name: string; path: string; size: string }> = [];
    for (const [, p] of Object.entries(project.specs)) {
      if (!p || !fs.existsSync(p)) continue;
      const bytes = fs.statSync(p).size;
      const size = bytes < 1024 ? `${bytes}b` : `${(bytes / 1024).toFixed(1)}kb`;
      out.push({ name: path.relative(project.workspaceRoot, p), path: p, size });
    }
    return out;
  }
}

export function deactivate() {}