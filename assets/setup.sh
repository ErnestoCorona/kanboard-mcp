#!/usr/bin/env bash
# kanboard-mcp setup GIF — hand-crafted output mirroring the real quick-start flow.
# Driven by assets/setup.tape via VHS to produce assets/setup.gif.
#
# Re-render with:  vhs assets/setup.tape

set -euo pipefail

# Clear screen + home cursor so the host shell prompt is gone from the recording.
printf '\033[2J\033[H'

RESET=$'\033[0m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
GREEN=$'\033[32m'
CYAN=$'\033[36m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
MAGENTA=$'\033[35m'

say() { printf '%s\n' "$1"; }

type_out() {
  local text="$1"
  local delay="${2:-0.018}"
  local len=${#text}
  for (( i=0; i<len; i++ )); do
    printf '%s' "${text:$i:1}"
    sleep "$delay"
  done
  printf '\n'
}

# --- Step 1: add config -----------------------------------------------------
say "${BOLD}${BLUE}① ${RESET}${BOLD}Add Kanboard MCP to your client config${RESET} ${DIM}(.mcp.json, claude_desktop_config.json, etc.)${RESET}"
sleep 0.9
say ""

say "${DIM}{${RESET}"
say "  ${CYAN}\"mcpServers\"${RESET}${DIM}: {${RESET}"
say "    ${CYAN}\"kanboard\"${RESET}${DIM}: {${RESET}"
say "      ${CYAN}\"command\"${RESET}${DIM}: ${RESET}${YELLOW}\"npx\"${RESET}${DIM},${RESET}"
say "      ${CYAN}\"args\"${RESET}${DIM}: [${RESET}${YELLOW}\"-y\"${RESET}${DIM}, ${RESET}${YELLOW}\"@ernestocorona/kanboard-mcp\"${RESET}${DIM}],${RESET}"
say "      ${CYAN}\"env\"${RESET}${DIM}: {${RESET}"
say "        ${CYAN}\"KANBOARD_URL\"${RESET}${DIM}: ${RESET}${YELLOW}\"https://kanboard.example.com\"${RESET}${DIM},${RESET}"
say "        ${CYAN}\"KANBOARD_USERNAME\"${RESET}${DIM}: ${RESET}${YELLOW}\"ernestocorona\"${RESET}${DIM},${RESET}"
say "        ${CYAN}\"KANBOARD_API_TOKEN\"${RESET}${DIM}: ${RESET}${YELLOW}\"••••••••••••\"${RESET}"
say "      ${DIM}}${RESET}"
say "    ${DIM}}${RESET}"
say "  ${DIM}}${RESET}"
say "${DIM}}${RESET}"
sleep 2.6

# --- Step 2: verify ---------------------------------------------------------
say ""
say "${BOLD}${BLUE}② ${RESET}${BOLD}Verify the connection${RESET} ${DIM}(one-shot, from your shell)${RESET}"
sleep 0.7
say ""
printf '%s ' "${DIM}❯${RESET}"
type_out "npx @ernestocorona/kanboard-mcp selftest" 0.030
sleep 1.0

# --- Step 3: live output ----------------------------------------------------
say "${GREEN}[ok]${RESET} kanboard server version: ${BOLD}1.2.45${RESET}"
sleep 0.55
say "${GREEN}[ok]${RESET} authenticated as: ${BOLD}ernestocorona${RESET} ${DIM}(id=3)${RESET}"
sleep 0.55
say "${GREEN}[ok]${RESET} visible projects: ${BOLD}7${RESET}"
sleep 0.55
say "${GREEN}[ok]${RESET} selftest passed ${DIM}(3 checks)${RESET}"
sleep 1.1

# --- Done -------------------------------------------------------------------
say ""
say "${BOLD}Done${RESET} — restart your client and the ${BOLD}${MAGENTA}37 tools${RESET} are live."
sleep 2.0
