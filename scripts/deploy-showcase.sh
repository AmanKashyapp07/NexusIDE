#!/usr/bin/env bash
set -e

echo "🚀 Deploying NexusIDE Showcase to GitHub Pages (gh-pages branch)..."

# Ensure we are in the workspace root
cd "$(dirname "$0")/.."

if [ ! -d "website" ]; then
  echo "❌ Error: website directory not found!"
  exit 1
fi

echo "📦 Extracting website/ subtree and pushing to origin/gh-pages..."
SUBTREE_COMMIT=$(git subtree split --prefix website HEAD)
git push origin "$SUBTREE_COMMIT":refs/heads/gh-pages --force

echo "✔ Deployment complete! Your showcase is live on GitHub Pages."
echo "👉 URL: https://amankashyapp07.github.io/NexusIDE/"
