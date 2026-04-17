#!/bin/bash
# Syncs backend/ from Vibecode workspace → PilotPay-tracker/pilotpaytracker on GitHub
# - Preserves landing/ and all other files in the production repo
# - Does NOT push mobile app, .env files, dev DB, or log files
set -e

CURRENT_BRANCH=$(git branch --show-current)
SYNC_BRANCH="_sync_backend_$(date +%s)"
STASHED=0

cleanup() {
  git checkout -f "$CURRENT_BRANCH" 2>/dev/null || true
  git branch -D "$SYNC_BRANCH" 2>/dev/null || true
  if [ "$STASHED" = "1" ]; then
    git stash pop 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "→ Stashing local changes..."
if ! git stash --include-untracked 2>&1 | grep -q "No local changes"; then
  STASHED=1
fi

echo "→ Fetching production remote..."
git fetch production

echo "→ Creating sync branch from production/main..."
git checkout -B "$SYNC_BRANCH" production/main

echo "→ Copying backend/src, package.json, prisma schema & migrations..."
git checkout main -- \
  backend/src \
  backend/package.json \
  backend/bun.lock \
  backend/prisma/schema.prisma \
  backend/prisma/migrations \
  backend/scripts \
  backend/public

if git diff --cached --quiet; then
  echo "✓ No backend changes — production is already up to date."
  exit 0
fi

echo "→ Changed files:"
git diff --cached --stat

echo "→ Committing..."
git add -A
git commit -m "chore: sync backend from Vibecode workspace [$(date '+%Y-%m-%d %H:%M')]"

echo "→ Pushing to production/main..."
git push production "$SYNC_BRANCH:main"

echo "✓ Backend synced to production successfully!"
