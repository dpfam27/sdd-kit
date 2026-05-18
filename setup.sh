#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# sdd-kit setup script
# Usage: bash setup.sh
# ─────────────────────────────────────────────────────────
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}SDD Kit — Spec-Driven Development${RESET}"
echo -e "${CYAN}Setting up...${RESET}"
echo ""

# ── 1. Python check ───────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python 3.10+ required. Install from https://python.org${RESET}"
  exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo $PY_VERSION | cut -d. -f1)
PY_MINOR=$(echo $PY_VERSION | cut -d. -f2)

if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]); then
  echo -e "${RED}✗ Python 3.10+ required. Found: $PY_VERSION${RESET}"
  exit 1
fi
echo -e "${GREEN}✓${RESET} Python $PY_VERSION"

# ── 2. pip install ────────────────────────────────────────
echo -e "${CYAN}Installing sdd-kit Python package...${RESET}"
pip install -e . --quiet
echo -e "${GREEN}✓${RESET} sdd-kit installed  (command: sdd)"

# ── 3. Verify sdd CLI works ───────────────────────────────
if ! command -v sdd &>/dev/null; then
  echo -e "${YELLOW}⚠ 'sdd' not in PATH. Try: pip install -e . --user${RESET}"
  echo -e "  Or add $(python3 -m site --user-base)/bin to your PATH"
else
  echo -e "${GREEN}✓${RESET} 'sdd' command available"
fi

# ── 4. ANTHROPIC_API_KEY check ────────────────────────────
echo ""
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${YELLOW}⚠  ANTHROPIC_API_KEY not set.${RESET}"
  echo -e "   Add to your shell profile:"
  echo -e "   ${BOLD}export ANTHROPIC_API_KEY=sk-ant-...${RESET}"
  echo ""
  read -p "   Paste your API key now (or press Enter to skip): " API_KEY
  if [ -n "$API_KEY" ]; then
    export ANTHROPIC_API_KEY="$API_KEY"
    # Detect shell profile
    PROFILE=""
    if [ -f "$HOME/.zshrc" ]; then PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then PROFILE="$HOME/.bash_profile"
    fi
    if [ -n "$PROFILE" ]; then
      echo "export ANTHROPIC_API_KEY=$API_KEY" >> "$PROFILE"
      echo -e "${GREEN}✓${RESET} Saved to $PROFILE"
    fi
  fi
else
  echo -e "${GREEN}✓${RESET} ANTHROPIC_API_KEY found"
fi

# ── 5. VS Code extension ──────────────────────────────────
echo ""
echo -e "${CYAN}Setting up VS Code extension...${RESET}"

if ! command -v code &>/dev/null; then
  echo -e "${YELLOW}⚠  VS Code CLI not found. Install extension manually:${RESET}"
  echo -e "   1. Open VS Code"
  echo -e "   2. Extensions panel → '...' menu → 'Install from VSIX'"
  echo -e "   3. Select: vscode-extension/ folder"
else
  EXT_DIR="$(pwd)/vscode-extension"
  if command -v npm &>/dev/null && [ -f "$EXT_DIR/package.json" ]; then
    echo -e "   Building extension..."
    cd "$EXT_DIR" && npm install --silent && npm run compile 2>/dev/null || true
    cd - > /dev/null
    # Install as dev extension
    code --install-extension "$EXT_DIR" 2>/dev/null || true
    echo -e "${GREEN}✓${RESET} VS Code extension installed"
  else
    echo -e "${YELLOW}⚠  npm not found — skipping extension build.${RESET}"
    echo -e "   Install Node.js from https://nodejs.org then re-run setup.sh"
  fi
fi

# ── Done ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓  Setup complete!${RESET}"
echo ""
echo -e "${BOLD}Quick start:${RESET}"
echo -e "  ${CYAN}sdd init${RESET}              # bootstrap a new project (CLI)"
echo -e "  ${CYAN}@sdd /init <idea>${RESET}     # bootstrap from VS Code chat"
echo -e "  ${CYAN}sdd skills${RESET}            # list all available skills"
echo ""
echo -e "${BOLD}Phase 2 skills (run inside a project):${RESET}"
echo -e "  ${CYAN}sdd design${RESET} / ${CYAN}sdd build${RESET} / ${CYAN}sdd test${RESET} / ${CYAN}sdd review${RESET}"
echo ""
