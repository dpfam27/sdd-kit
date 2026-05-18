"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// ─── activation ───────────────────────────────────────────────────
function activate(context) {
    const participant = vscode.chat.createChatParticipant("sdd-kit.agent", handleChatRequest);
    participant.iconPath = new vscode.ThemeIcon("book");
    context.subscriptions.push(vscode.commands.registerCommand("sdd-kit.openPanel", () => {
        SddPanel.createOrShow(context.extensionUri);
    }), vscode.commands.registerCommand("sdd-kit.showDocs", () => {
        openSpecDocs();
    }), participant);
}
// ─── chat participant handler ──────────────────────────────────────
async function handleChatRequest(request, context, stream, token) {
    const command = request.command;
    const userText = request.prompt.trim();
    if (!command) {
        stream.markdown("**SDD Kit** — Spec-Driven Development\n\n" +
            "Available commands:\n" +
            "- `/init <description>` — bootstrap a new project\n" +
            "- `/design` — redesign or add a feature\n" +
            "- `/build` — implement from spec\n" +
            "- `/test` — run + fix tests\n" +
            "- `/refactor` — clean up code\n" +
            "- `/review` — review vs spec\n" +
            "- `/update-doc` — sync docs to code\n");
        return;
    }
    const projectRoot = getProjectRoot();
    if (command === "init") {
        if (!userText) {
            stream.markdown("Tell me what you want to build in one sentence:\n\n`/init a sales analytics dashboard`");
            return;
        }
        await runInit(userText, stream, token);
        return;
    }
    if (!projectRoot) {
        stream.markdown("⚠️ No SDD project found. Run `/init <description>` first.");
        return;
    }
    await runSkill(command, userText, projectRoot, stream, token);
}
// ─── /init flow ───────────────────────────────────────────────────
async function runInit(description, stream, token) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        stream.markdown("⚠️ Open a workspace folder first.");
        return;
    }
    stream.markdown(`**Starting /init** for: *"${description}"*\n\n`);
    // Step 1: Ask Claude to generate Q&A questions
    const [model] = await vscode.lm.selectChatModels({ family: "claude-3-5-sonnet" });
    if (!model) {
        stream.markdown("⚠️ No Claude model available. Make sure GitHub Copilot is enabled.");
        return;
    }
    stream.progress("Generating elicitation questions...");
    const qPrompt = [
        vscode.LanguageModelChatMessage.User(`User wants to build: "${description}"\n\n` +
            `Generate 6-8 essential questions to ask before scaffolding this project. ` +
            `Return ONLY a JSON array of question strings, no markdown.`)
    ];
    let questions = [];
    try {
        const qResponse = await model.sendRequest(qPrompt, {}, token);
        let qText = "";
        for await (const chunk of qResponse.text) {
            qText += chunk;
        }
        questions = JSON.parse(qText.trim());
    }
    catch (err) {
        stream.markdown(`⚠️ Failed to generate questions: ${err}`);
        return;
    }
    // Step 2: Ask user via input boxes
    stream.markdown("**Answer these questions:**\n\n");
    const answers = { project_description: description };
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
        vscode.LanguageModelChatMessage.User(`Generate a complete SDD (Spec-Driven Development) document set for this project.\n\n` +
            `User answers:\n${JSON.stringify(answers, null, 2)}\n\n` +
            `Generate 4 markdown files:\n` +
            `1. constitution.md — master spec with project name, stack, users, rules, MVP scope\n` +
            `2. PRD.md — problem, goals, features, success metrics\n` +
            `3. ARCHITECTURE.md — folder structure, components, API contracts, data models\n` +
            `4. FEATURE_SPEC_MVP.md — detailed feature breakdown for MVP\n\n` +
            `Output format: <<<FILE path/to/file.md>>>\\n<content>\\n<<<END>>> for each file.`)
    ];
    const projectName = answers["Project name?"] || answers["project name"] || "my-project";
    const projectSlug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const projectDir = path.join(workspaceRoot, projectSlug);
    const docsDir = path.join(projectDir, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    try {
        const genResponse = await model.sendRequest(genPrompt, {}, token);
        let fullText = "";
        for await (const chunk of genResponse.text) {
            fullText += chunk;
        }
        // Parse and write files
        const fileRegex = /<<<FILE (.+?)>>>\n([\s\S]+?)<<<END>>>/g;
        let match;
        const createdFiles = [];
        while ((match = fileRegex.exec(fullText)) !== null) {
            const relPath = match[1].trim();
            const content = match[2];
            const fullPath = path.join(projectDir, relPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, "utf-8");
            createdFiles.push(relPath);
        }
        stream.markdown("\n✅ **Spec docs created:**\n");
        for (const f of createdFiles) {
            stream.markdown(`- ${f}\n`);
        }
        // Step 4: Suggest next actions
        stream.markdown(`\n**Next steps:**\n` +
            `1. Review the spec docs in \`${projectSlug}/docs/\`\n` +
            `2. Run \`@sdd /build\` to scaffold code\n` +
            `3. Run \`@sdd /test\` to generate tests\n`);
        stream.button({
            command: "vscode.open",
            title: "Open constitution.md",
            arguments: [vscode.Uri.file(path.join(docsDir, "constitution.md"))],
        });
    }
    catch (err) {
        stream.markdown(`\n❌ Error: ${err}`);
    }
}
// ─── Phase 2 skill runner ──────────────────────────────────────────
async function runSkill(skillName, userPrompt, projectRoot, stream, token) {
    stream.progress(`Running /${skillName}...`);
    // Load skill manifest to know what context to inject
    const manifest = getSkillManifest(skillName);
    if (!manifest) {
        stream.markdown(`⚠️ Unknown skill: /${skillName}`);
        return;
    }
    // Load only the spec sections this skill needs
    const context = loadContext(projectRoot, manifest.context_needs);
    // Get VS Code LM
    const [model] = await vscode.lm.selectChatModels({ family: "claude-3-5-sonnet" });
    if (!model) {
        stream.markdown("⚠️ No Claude model available.");
        return;
    }
    // Build agent prompt
    const systemPrompt = `You are sdd-kit, a Spec-Driven Development agent.\n` +
        `Skill: /${skillName} — ${manifest.name}\n` +
        `Project root: ${projectRoot}\n\n` +
        `Context (spec sections loaded):\n${context}\n\n` +
        `User request: ${userPrompt || "Run this skill"}\n\n` +
        `Your task: ${getSkillTask(skillName)}\n\n` +
        `Output format: For any files you create/modify, use:\n` +
        `<<<FILE path/to/file>>>\\n<content>\\n<<<END>>>\n\n` +
        `After all file blocks, output a summary in this format:\n` +
        `<<<SUMMARY>>>\\n- What was done\\n- What was done\\n<<<NEXT>>>\\n1. Suggested next step\\n2. Another step\\n<<<END>>>`;
    const messages = [vscode.LanguageModelChatMessage.User(systemPrompt)];
    try {
        const response = await model.sendRequest(messages, {}, token);
        let fullText = "";
        for await (const chunk of response.text) {
            fullText += chunk;
            stream.markdown(chunk);
        }
        // Parse and write files
        const fileRegex = /<<<FILE (.+?)>>>\n([\s\S]+?)<<<END>>>/g;
        let match;
        const createdFiles = [];
        while ((match = fileRegex.exec(fullText)) !== null) {
            const relPath = match[1].trim();
            const content = match[2];
            const fullPath = path.join(projectRoot, relPath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, "utf-8");
            createdFiles.push(relPath);
        }
        if (createdFiles.length > 0) {
            stream.markdown(`\n\n**Files modified:**\n`);
            for (const f of createdFiles) {
                stream.markdown(`- ${f}\n`);
            }
        }
    }
    catch (err) {
        stream.markdown(`\n❌ Error: ${err}`);
    }
}
// ─── helpers ──────────────────────────────────────────────────────
function getSkillManifest(skillName) {
    const manifests = {
        design: {
            name: "Redesign or add a feature",
            context_needs: ["constitution:rules", "constitution:stack", "architecture"],
            loop_steps: ["plan", "scaffold", "build", "test", "report"],
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
function getSkillTask(skillName) {
    const tasks = {
        design: "Analyze the request, update ARCHITECTURE.md and FEATURE_SPEC_MVP.md with the new design. Output the updated files.",
        build: "Implement the feature by creating/modifying code files. Follow the architecture spec. Output all modified files.",
        test: "Write or fix tests for the current codebase. Output test files.",
        refactor: "Clean up the code while staying aligned with the architecture. Output refactored files.",
        review: "Review the codebase against the spec. Output a REVIEW.md with findings.",
        "update-doc": "Detect what changed in the code vs the spec docs. Update the spec docs to match reality. Output updated doc files.",
    };
    return tasks[skillName] || "Execute the skill task.";
}
function loadContext(projectRoot, needs) {
    const parts = [];
    const docMap = {
        "constitution:rules": "docs/constitution.md",
        "constitution:stack": "docs/constitution.md",
        "constitution:full": "docs/constitution.md",
        prd: "docs/PRD.md",
        architecture: "docs/ARCHITECTURE.md",
        feature_spec: "docs/FEATURE_SPEC_MVP.md",
    };
    for (const need of needs) {
        const docPath = docMap[need];
        if (!docPath)
            continue;
        const fullPath = path.join(projectRoot, docPath);
        if (!fs.existsSync(fullPath))
            continue;
        let content = fs.readFileSync(fullPath, "utf-8");
        // For constitution sections, extract only the relevant section
        if (need.startsWith("constitution:") && need !== "constitution:full") {
            const section = need.split(":")[1];
            const regex = new RegExp(`## ${section}[\\s\\S]+?(?=\\n##|$)`, "i");
            const match = content.match(regex);
            content = match ? match[0] : "";
        }
        if (content) {
            parts.push(`<!-- ${need} -->\n${content}`);
        }
    }
    return parts.join("\n\n");
}
function getProjectRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders)
        return null;
    for (const folder of folders) {
        const constitution = path.join(folder.uri.fsPath, "docs", "constitution.md");
        if (fs.existsSync(constitution)) {
            return folder.uri.fsPath;
        }
    }
    return null;
}
function openSpecDocs() {
    const root = getProjectRoot();
    if (!root) {
        vscode.window.showInformationMessage("No SDD project found. Run /init first.");
        return;
    }
    const docsDir = path.join(root, "docs");
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
    const items = files.map((f) => ({ label: f, path: path.join(docsDir, f) }));
    vscode.window.showQuickPick(items.map((i) => i.label)).then((picked) => {
        if (picked !== undefined) {
            const item = items.find((i) => i.label === picked);
            if (item)
                vscode.window.showTextDocument(vscode.Uri.file(item.path));
        }
    });
}
// ─── SDD panel (spec docs viewer) ─────────────────────────────────
class SddPanel {
    static createOrShow(extensionUri) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;
        if (SddPanel.currentPanel) {
            SddPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel("sddKit", "SDD Kit — Spec", column, { enableScripts: true, retainContextWhenHidden: true });
        SddPanel.currentPanel = new SddPanel(panel, extensionUri);
    }
    constructor(panel, extensionUri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.webview.html = this._getHtml();
        this._panel.onDidDispose(() => { SddPanel.currentPanel = undefined; });
        this._panel.webview.onDidReceiveMessage((msg) => {
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
    _getHtml() {
        const root = getProjectRoot();
        const docs = root ? this._loadDocs(root) : [];
        const docItems = docs.map((d) => `<div class="doc-item" onclick="openFile('${d.path.replace(/\\/g, "\\\\")}')">
        <span class="doc-icon">📄</span>
        <span class="doc-name">${d.name}</span>
        <span class="doc-size">${d.size}</span>
      </div>`).join("");
        const skills = [
            { cmd: "design", label: "/design", desc: "Redesign a feature" },
            { cmd: "build", label: "/build", desc: "Implement from spec" },
            { cmd: "test", label: "/test", desc: "Run + fix tests" },
            { cmd: "refactor", label: "/refactor", desc: "Clean up code" },
            { cmd: "review", label: "/review", desc: "Review vs spec" },
            { cmd: "update-doc", label: "/update-doc", desc: "Sync docs to code" },
        ];
        const skillButtons = skills.map((s) => `<button class="skill-btn" onclick="runSkill('${s.cmd}')">
        <strong>${s.label}</strong>
        <span>${s.desc}</span>
      </button>`).join("");
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
    _loadDocs(root) {
        const docsDir = path.join(root, "docs");
        if (!fs.existsSync(docsDir))
            return [];
        return fs.readdirSync(docsDir)
            .filter((f) => f.endsWith(".md"))
            .map((f) => {
            const p = path.join(docsDir, f);
            const bytes = fs.statSync(p).size;
            const size = bytes < 1024 ? `${bytes}b` : `${(bytes / 1024).toFixed(1)}kb`;
            return { name: f, path: p, size };
        });
    }
}
function deactivate() { }
