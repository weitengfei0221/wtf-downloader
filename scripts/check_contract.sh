#!/usr/bin/env bash
# Contract parity gate: commands registered in Rust must match SPEC §5.1 exactly,
# AND every command the frontend calls must actually be registered.
#
# Why: SPEC §5.1 is declared the single source of truth for the IPC contract.
# A rename on either side (e.g. "unify to camelCase") breaks the app silently —
# frontend tests mock the invoke shell and never assert command strings, and
# cargo test never touches the frontend call sites. Neither layer can catch it,
# so the only reliable check is a mechanical diff of doc vs code.
#
# 2026-11-05: added truth source 3 (frontend call sites). When two agents write
# the Rust command and the JS caller in parallel, a name drift produces a fully
# silent dead feature: no compile error, no test failure, just nothing happens.
# The UI set must be a SUBSET of registered commands (one-directional: a
# tray-only command may legitimately have no JS caller).
#
# Usage: bash scripts/check_contract.sh   (run from repo root)
#        WTF_UI_API_DIR=/path bash scripts/check_contract.sh  # override for gate self-tests
# Exit:  0 = parity holds, 1 = drift detected, 2 = missing inputs
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/crates/app/src/lib.rs"
SPEC="$ROOT/docs/SPEC.md"
UI_API="${WTF_UI_API_DIR:-$ROOT/ui/src/api}"

if [ ! -f "$LIB" ] || [ ! -f "$SPEC" ]; then
  echo "CONTRACT GATE ERROR: missing $LIB or $SPEC"
  exit 2
fi
if [ ! -d "$UI_API" ]; then
  echo "CONTRACT GATE ERROR: missing $UI_API"
  exit 2
fi

TMP_CODE=/tmp/wtf_cmd_code.txt
TMP_DOC=/tmp/wtf_cmd_doc.txt
TMP_UI=/tmp/wtf_cmd_ui.txt

# Truth source 1: commands actually registered in invoke_handler!
sed -n '/generate_handler!/,/])/p' "$LIB" \
  | grep -oE 'commands::[a-z_]+::[a-z_]+' \
  | sed 's/.*:://' \
  | sort -u > "$TMP_CODE"

# Truth source 2: command names documented in SPEC §5.1 (backticked snake_case
# tokens in the table's first column). Status names are filtered out.
awk '/^### 5\.1/,/^### 5\.2/' "$SPEC" \
  | grep -oE '`[a-z_]+`' \
  | tr -d '`' \
  | grep -vE '^(all|downloading|completed|failed)$' \
  | sort -u > "$TMP_DOC"

# Truth source 3: command names the frontend actually invokes from src/api/*.ts.
# Only the first string literal after `invoke...(` is a command name; the
# invoke wrapper's own definition does not match this pattern.
grep -rhoE "invoke(<[^>]*>)?\([[:space:]]*['\"][a-z_]+['\"]" "$UI_API"/*.ts 2>/dev/null \
  | grep -oE "['\"][a-z_]+['\"]" \
  | tr -d "'\"" \
  | sort -u > "$TMP_UI"

code_n=$(wc -l < "$TMP_CODE")
doc_n=$(wc -l < "$TMP_DOC")
ui_n=$(wc -l < "$TMP_UI")

echo "commands registered in lib.rs : $code_n"
echo "commands documented in SPEC  : $doc_n"
echo "commands called from ui/api  : $ui_n"

if ! diff -u "$TMP_CODE" "$TMP_DOC"; then
  echo "CONTRACT GATE FAILED: SPEC §5.1 and invoke_handler! disagree."
  echo "  '-' lines exist only in code  (documented missing)"
  echo "  '+' lines exist only in SPEC  (implemented missing)"
  exit 1
fi

# One-directional: every JS call must resolve to a registered command.
undeclared=$(comm -23 "$TMP_UI" "$TMP_CODE")
if [ -n "$undeclared" ]; then
  echo "CONTRACT GATE FAILED: frontend calls unregistered command(s):"
  echo "$undeclared"
  exit 1
fi

if [ "$ui_n" -eq 0 ]; then
  echo "CONTRACT GATE FAILED: no frontend invocations found under $UI_API (empty scan cannot pass)"
  exit 1
fi

echo "CONTRACT GATE PASSED (doc == code, $code_n commands; $ui_n JS calls all registered)"
exit 0
