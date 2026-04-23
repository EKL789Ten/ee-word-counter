#!/usr/bin/env bash
#
# push.sh — commit and push the site to GitHub.
#
# One-time setup (before first run):
#   1. Create a new empty GitHub repo, e.g. github.com/<YOUR_GITHUB_USER>/ee-word-counter
#   2. Copy .env.example to .env and fill in the values:
#         GITHUB_USER=<YOUR_GITHUB_USER>
#         GITHUB_REPO=ee-word-counter
#         GITHUB_BRANCH=main
#      (Or export them in your shell.)
#   3. Make sure `git` is authenticated — either a PAT configured as the
#      remote URL credential, or the GitHub CLI (`gh auth login`), or SSH keys.
#
# Usage:
#   ./scripts/push.sh "commit message here"
#   # If no message is given, uses a timestamp-based default.
#
set -euo pipefail

# Resolve project root (the parent of this scripts/ directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Load .env if present (never commit .env)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${GITHUB_USER:=<YOUR_GITHUB_USER>}"
: "${GITHUB_REPO:=ee-word-counter}"
: "${GITHUB_BRANCH:=main}"

if [[ "$GITHUB_USER" == "<YOUR_GITHUB_USER>" ]]; then
  echo "⚠  GITHUB_USER is unset. Edit .env or export GITHUB_USER=<your-handle> and retry."
  exit 1
fi

COMMIT_MSG="${1:-"site update — $(date -u +'%Y-%m-%dT%H:%M:%SZ')"}"

# Initialise repo on first run
if [[ ! -d .git ]]; then
  echo "→ Initialising git repo"
  git init -b "$GITHUB_BRANCH"
fi

# Configure remote (idempotent)
REMOTE_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

echo "→ Remote: $REMOTE_URL"
echo "→ Branch: $GITHUB_BRANCH"

# Stage, commit, push
git add -A

if git diff --cached --quiet; then
  echo "→ No changes to commit. Exiting."
  exit 0
fi

git commit -m "$COMMIT_MSG"

# Ensure current branch matches the configured branch name
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "$GITHUB_BRANCH" ]]; then
  git branch -M "$GITHUB_BRANCH"
fi

# First push may need --set-upstream
if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  git push
else
  git push --set-upstream origin "$GITHUB_BRANCH"
fi

echo "✓ Pushed to $REMOTE_URL ($GITHUB_BRANCH)"
