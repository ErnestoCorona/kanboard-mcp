#!/usr/bin/env bash
# kanboard-mcp demo session — hand-crafted output mirroring the actual tool flow.
# Driven by assets/demo.tape via VHS to produce assets/demo.gif.
#
# Re-render with:  vhs assets/demo.tape

set -euo pipefail

# Clear screen + home cursor so the host shell prompt is gone from the recording.
printf '\033[2J\033[H'

RESET=$'\033[0m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
GREEN=$'\033[32m'
CYAN=$'\033[36m'
MAGENTA=$'\033[35m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'

say() { printf '%s\n' "$1"; }

type_out() {
  local text="$1"
  local delay="${2:-0.025}"
  local len=${#text}
  for (( i=0; i<len; i++ )); do
    printf '%s' "${text:$i:1}"
    sleep "$delay"
  done
  printf '\n'
}

# --- 1. User prompt ---------------------------------------------------------
printf '%s' "${BOLD}${BLUE}You${RESET} ${DIM}❯${RESET} "
type_out "Take this customer email and turn it into a Mobile sprint backlog." 0.030
sleep 0.6

# --- 2. Claude responding ---------------------------------------------------
say ""
printf '%s' "${BOLD}${MAGENTA}Claude${RESET} ${DIM}(via kanboard-mcp)${RESET}"
sleep 0.8
say ""
say ""

# --- 3. Tool calls ----------------------------------------------------------
printf '  %s ' "${CYAN}●${RESET}"
type_out "list_projects()" 0.022
sleep 0.7
say "      ${GREEN}✓${RESET} ${DIM}resolved \"Mobile\" → project #42${RESET}"
sleep 0.55

printf '  %s ' "${CYAN}●${RESET}"
type_out "list_columns(project_id: 42)" 0.022
sleep 0.7
say "      ${GREEN}✓${RESET} ${DIM}Backlog column = #588${RESET}"
sleep 0.55

printf '  %s ' "${CYAN}●${RESET}"
type_out "create_tasks_batch(project_id: 42, tasks: [...8 items])" 0.018
sleep 1.0
say "      ${GREEN}✓${RESET} ${DIM}8 tasks created in #42/Backlog (1 round-trip)${RESET}"
sleep 0.55

printf '  %s ' "${CYAN}●${RESET}"
type_out "list_my_tasks()" 0.022
sleep 0.7
say "      ${GREEN}✓${RESET} ${DIM}priorities re-sorted${RESET}"
sleep 0.9

# --- 4. Summary -------------------------------------------------------------
say ""
say "${BOLD}Done${RESET} — 8 tasks in ${BOLD}Mobile/Backlog${RESET}, sorted by priority."
sleep 0.6
say ""
say "${DIM}Top 3:${RESET}"
say "  ${BOLD}${YELLOW}P1${RESET}  Fix login error on iOS 18.2"
sleep 0.30
say "  ${BOLD}${YELLOW}P1${RESET}  Flaky CI on PR #1247"
sleep 0.30
say "  ${BOLD}P2${RESET}  Onboarding redesign review"
sleep 1.8
