#!/usr/bin/env bash
#
# deploy.sh — deploy the site to Cloudflare Pages via Wrangler.
#
# One-time setup:
#   1. Install Node 18+ and Wrangler:        npm i -g wrangler
#   2. Create a Cloudflare account and Pages project (can be done on first
#      deploy — Wrangler will prompt). Jot down the project name.
#   3. Auth Wrangler:                        wrangler login
#      (Opens a browser; authorises your account.)
#      — OR — set a Cloudflare API token with "Cloudflare Pages — Edit"
#             permission as CLOUDFLARE_API_TOKEN, plus CLOUDFLARE_ACCOUNT_ID.
#   4. Copy .env.example to .env and fill in:
#         CLOUDFLARE_ACCOUNT_ID=<YOUR_CLOUDFLARE_ACCOUNT_ID>   # optional w/ `wrangler login`
#         CLOUDFLARE_API_TOKEN=<YOUR_CLOUDFLARE_API_TOKEN>     # optional w/ `wrangler login`
#         CF_PAGES_PROJECT=ee-word-counter
#         CF_PAGES_BRANCH=main                                 # "main" = production
#
# Usage:
#   ./scripts/deploy.sh                # deploys production
#   ./scripts/deploy.sh preview        # deploys to a preview URL
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Load .env if present
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${CF_PAGES_PROJECT:=<YOUR_CLOUDFLARE_PAGES_PROJECT>}"
: "${CF_PAGES_BRANCH:=main}"

if [[ "$CF_PAGES_PROJECT" == "<YOUR_CLOUDFLARE_PAGES_PROJECT>" ]]; then
  echo "⚠  CF_PAGES_PROJECT is unset. Edit .env or export CF_PAGES_PROJECT=<project> and retry."
  exit 1
fi

# Preview or production?
MODE="${1:-production}"
if [[ "$MODE" == "preview" ]]; then
  BRANCH="preview-$(date -u +'%Y%m%d-%H%M%S')"
  echo "→ Preview deploy (branch: $BRANCH)"
else
  BRANCH="$CF_PAGES_BRANCH"
  echo "→ Production deploy (branch: $BRANCH)"
fi

# Ensure wrangler is available
if ! command -v wrangler >/dev/null 2>&1; then
  echo "⚠  wrangler not found. Install with: npm i -g wrangler"
  exit 1
fi

# Verify auth — either env token or saved login
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "→ Using CLOUDFLARE_API_TOKEN from environment"
else
  if ! wrangler whoami >/dev/null 2>&1; then
    echo "⚠  Not logged in. Run: wrangler login   (or set CLOUDFLARE_API_TOKEN)"
    exit 1
  fi
fi

# Build asset manifest — this site is static, no build step, but we prune
# any stray dev files that shouldn't ship.
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

echo "→ Staging build at $STAGING_DIR"
rsync -a \
  --exclude '.git' \
  --exclude 'scripts' \
  --exclude '.env' \
  --exclude '.env.example' \
  --exclude 'node_modules' \
  --exclude 'README.md' \
  --exclude '.gitignore' \
  --exclude 'wrangler.toml' \
  --exclude 'DEPLOYMENT.md' \
  "$PROJECT_ROOT"/ "$STAGING_DIR"/

# Copy Cloudflare-specific files from the project root if present
[[ -f "$PROJECT_ROOT/_headers"   ]] && cp "$PROJECT_ROOT/_headers"   "$STAGING_DIR/"
[[ -f "$PROJECT_ROOT/_redirects" ]] && cp "$PROJECT_ROOT/_redirects" "$STAGING_DIR/"

# Deploy
echo "→ Deploying to Cloudflare Pages project: $CF_PAGES_PROJECT"
wrangler pages deploy "$STAGING_DIR" \
  --project-name "$CF_PAGES_PROJECT" \
  --branch "$BRANCH" \
  --commit-dirty=true

echo "✓ Deploy complete."
