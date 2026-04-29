#!/usr/bin/env bash
# scripts/fallow-ci.sh
#
# Run fallow with the same flags GitHub Actions uses for the
# `codebase-health` job, so issues that would block PR merge are
# surfaced locally before pushing.
#
# What this mirrors (from fallow-rs/fallow@v2 action.yml + analyze.sh):
#   - bare command (runs dead-code, dupes, and health analyses together)
#   - --root .
#   - --quiet
#   - --format human (CI uses json for parsing; human is friendlier locally)
#   - --changed-since <merge-base with origin/main>
#       (CI uses the PR base SHA; merge-base is the closest local equivalent)
#
# IMPORTANT — known parity gap:
#   fallow's clone-detection has empirical platform variation. The same
#   command, fallow version, commit, and base SHA can return 0 dupes on
#   macOS arm64 and 1+ dupes on the CI Linux x64 runner. This is a
#   tooling-level limitation, not a config bug. This script catches
#   most issues most of the time, but CI remains the ground truth.
#   When CI flags a clone you can't reproduce locally, just dedupe by
#   intent and re-push.

set -euo pipefail

# Make sure origin/main is fresh — CI's PR base SHA is whatever main
# pointed at when the PR was opened, so we mirror by syncing first.
git fetch --quiet origin main

BASE_SHA=$(git merge-base origin/main HEAD)

if [ -z "$BASE_SHA" ]; then
  echo "Could not determine merge-base with origin/main; running fallow without --changed-since."
  exec npx fallow --root . --format human
fi

echo "Running fallow scoped to changes since $(git rev-parse --short "$BASE_SHA")..."
exec npx fallow --root . --format human --changed-since "$BASE_SHA"
