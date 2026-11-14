#!/usr/bin/env bash
# Gate: the app version must be consistent across all three sources, and must
# never be lower than the newest released tag.
#
# Why this exists (2026-11-13): Cargo.toml + crates/app/tauri.conf.json were
# reverted from 0.1.1 to 0.1.0 TWICE in one afternoon (15:19 and 16:37) while
# 0.1.1 was already published. A downgraded version makes the locally built
# package older than the released one: the updater compares versions, so the
# app stops offering updates and the next release can never be "newer".
# Nothing failed loudly — the tree just looked dirty. This gate makes that loud.
#
# Sources checked:
#   1. Cargo.toml  [workspace.package].version   (crates inherit via workspace)
#   2. crates/app/tauri.conf.json  version       (bundle + updater compare this)
#   3. Cargo.lock  app + downloader-engine       (what actually gets compiled)
#   4. newest git tag vX.Y.Z                     (must be <= source version)
#
# Usage: bash scripts/check_version.sh
set -u
cd "$(dirname "$0")/.." || exit 1

fail=0

cargo_ver=$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)
conf_ver=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' crates/app/tauri.conf.json | head -1)

lock_app=$(awk '/^name = "app"$/{getline; print; exit}' Cargo.lock | sed -n 's/^version = "\(.*\)"$/\1/p')
lock_eng=$(awk '/^name = "downloader-engine"$/{getline; print; exit}' Cargo.lock | sed -n 's/^version = "\(.*\)"$/\1/p')

echo "Cargo.toml            : ${cargo_ver:-<missing>}"
echo "tauri.conf.json       : ${conf_ver:-<missing>}"
echo "Cargo.lock app        : ${lock_app:-<missing>}"
echo "Cargo.lock engine     : ${lock_eng:-<missing>}"

if [ -z "$cargo_ver" ] || [ -z "$conf_ver" ] || [ -z "$lock_app" ] || [ -z "$lock_eng" ]; then
    echo "VERSION GATE FAILED: one of the four version sources is unreadable"
    exit 1
fi

for pair in "tauri.conf.json:$conf_ver" "Cargo.lock(app):$lock_app" "Cargo.lock(engine):$lock_eng"; do
    name=${pair%%:*}
    value=${pair#*:}
    if [ "$value" != "$cargo_ver" ]; then
        echo "MISMATCH: $name = $value, but Cargo.toml = $cargo_ver"
        fail=1
    fi
done

# Newest reachable tag wins: the built app must never be older than what we shipped.
tag=$(git tag --list 'v*' | sed 's/^v//' | sort -V | tail -1)
if [ -n "$tag" ]; then
    echo "newest released tag   : v$tag"
    newest=$(printf '%s\n%s\n' "$tag" "$cargo_ver" | sort -V | tail -1)
    if [ "$newest" != "$cargo_ver" ]; then
        echo "DOWNGRADE: source version $cargo_ver is LOWER than released tag v$tag"
        fail=1
    fi
fi

if [ "$fail" -ne 0 ]; then
    echo "VERSION GATE FAILED"
    exit 1
fi
echo "VERSION GATE PASSED (all sources = $cargo_ver)"
