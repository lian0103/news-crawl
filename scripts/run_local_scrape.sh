#!/usr/bin/env bash
set -euo pipefail

# Change to repo root
cd "$(dirname "$0")/.."

# Optional: ensure dependencies are installed (uncomment if you want to auto-install)
# npm ci

# Run crawl -> export -> deploy
npm run scrape-export-deploy
