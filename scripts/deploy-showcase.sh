#!/usr/bin/env bash
set -e

echo "🚀 Deploying NexusIDE Showcase to GitHub Pages (gh-pages branch)..."

# Ensure we are in the workspace root
cd "$(dirname "$0")/.."

if [ ! -d "website" ]; then
  echo "❌ Error: website directory not found!"
  exit 1
fi

# Option 1: Git subtree push to gh-pages branch
echo "📦 Pushing website/ folder to origin/gh-pages via git subtree..."
git subtree push --prefix website origin gh-pages 2>/dev/null || {
  echo "ℹ️ Subtree push note: If this is the first push or branch exists, creating clean orphan branch..."
  TMP_DIR=$(mktemp -d)
  cp -r website/* "$TMP_DIR/"
  
  CURRENT_BRANCH=$(git branch --show-current)
  git checkout -B gh-pages
  rm -rf *
  cp -r "$TMP_DIR"/* .
  git add .
  git commit -m "Deploy showcase site to GitHub Pages" || true
  git push -u origin gh-pages --force
  git checkout "$CURRENT_BRANCH"
  rm -rf "$TMP_DIR"
}

echo "✔ Deployment complete! Your showcase is live on GitHub Pages."
echo "👉 Check: Settings -> Pages -> Source: Deploy from branch -> 'gh-pages' / (root)"
