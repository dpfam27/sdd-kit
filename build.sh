#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# build.sh — run this before `python -m build`
# Compiles the VS Code extension → .vsix → copies into
# sdd_kit/extension/ so it gets bundled in the pip package
# ─────────────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}SDD Kit — Build${RESET}"
echo ""

# ── 1. Build VS Code extension ────────────────────────────
echo -e "${CYAN}Building VS Code extension...${RESET}"
cd vscode-extension

npm install --silent
npm run compile

# Install vsce if not present
if ! command -v vsce &>/dev/null; then
  echo "  Installing @vscode/vsce..."
  npm install -g @vscode/vsce --silent
fi

vsce package --no-dependencies --out ../sdd_kit/extension/sdd-kit.vsix 2>/dev/null
cd ..

echo -e "${GREEN}✓${RESET} Extension bundled → sdd_kit/extension/sdd-kit.vsix"

# ── 2. Build Python package ───────────────────────────────
echo -e "${CYAN}Building Python package...${RESET}"

python3 -m pip install --upgrade pip setuptools wheel build --quiet
python3 -m build --wheel --outdir dist/

echo -e "${GREEN}✓${RESET} Python package built → dist/"
echo ""

# ── Summary ───────────────────────────────────────────────
WHEEL=$(ls dist/*.whl 2>/dev/null | head -1)
echo -e "${BOLD}Done!${RESET}"
echo ""
echo -e "  Distribute: ${CYAN}$WHEEL${RESET}"
echo ""
echo -e "  User installs with:"
echo -e "  ${CYAN}pip install sdd-kit${RESET}          # from PyPI after twine upload"
echo -e "  ${CYAN}sdd install-extension${RESET}        # installs VS Code extension"
echo ""
echo -e "  Or share the .whl directly:"
echo -e "  ${CYAN}pip install $WHEEL${RESET}"
echo -e "  ${CYAN}sdd install-extension${RESET}"
echo ""