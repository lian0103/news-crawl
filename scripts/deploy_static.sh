#!/usr/bin/env bash
set -euo pipefail

# Simple deploy script: add public/data files, commit, and push to origin main
BRANCH=${1:-main}
MSG=${2:-"chore: update static data $(date -u +"%Y-%m-%dT%H:%M:%SZ")"}

# Ensure we're on the correct branch
git checkout $BRANCH

git add public/data || true

# Commit if there are changes
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "$MSG"
  git push origin $BRANCH
fi
