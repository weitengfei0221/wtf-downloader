#!/usr/bin/env bash
# Gate: no source file exceeds 300 non-empty lines (ARCHITECTURE hard rule).
# Usage: bash scripts/check_lines.sh [dir]   (default: crates)
#
# 2026-11-05: this gate previously matched only '*.rs'. Running it against
# ui/src therefore scanned ZERO files yet still printed "LINE GATE PASSED" —
# an empty-set false positive that left the whole frontend ungated. It now:
#   1. covers every source extension used by this repo,
#   2. excludes generated / vendored trees,
#   3. reports the scanned file count (denominator),
#   4. fails on an empty scan, so a false PASS can never come from an empty set.
# Verification method: inject a >300-line file and an empty dir, prove exit=1,
# then remove and re-run. See docs/phase2/DESIGN.md §9.1 rule 4.
set -u
DIR="${1:-crates}"
fail=0
count=0
while IFS= read -r -d '' f; do
    count=$((count + 1))
    lines=$(grep -cve '^[[:space:]]*$' "$f")
    if [ "$lines" -gt 300 ]; then
        echo "OVER: $f ($lines non-empty lines)"
        fail=1
    fi
done < <(find "$DIR" -type f \
    \( -name '*.rs' -o -name '*.ts' -o -name '*.tsx' -o -name '*.vue' \
       -o -name '*.css' -o -name '*.js' -o -name '*.jsx' \) \
    -not -path '*/node_modules/*' -not -path '*/target/*' \
    -not -path '*/dist/*' -not -path '*/gen/*' -print0)

echo "scanned: $count source file(s) under $DIR"

if [ "$count" -eq 0 ]; then
    echo "LINE GATE FAILED: no source files matched under $DIR (empty scan cannot pass)"
    exit 1
fi
if [ "$fail" -ne 0 ]; then
    echo "LINE GATE FAILED"
    exit 1
fi
echo "LINE GATE PASSED ($count files, all <= 300 non-empty lines)"
