#!/bin/bash
# Cut a macOS release and update the public download. Bumps the patch version
# (or uses the version passed as $1), runs the suite, rebuilds the Apple
# Silicon zip, and publishes a GitHub release. The portfolio's download button
# points at releases/latest/download/Pick-42-mac-arm64.zip, so the asset name
# must never change. Usage: npm run release:mac [-- 0.2.0]
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean — commit or stash before releasing." >&2
  exit 1
fi

npm test

version="${1:-$(node -e "const v = require('./package.json').version.split('.'); v[2] = Number(v[2]) + 1; process.stdout.write(v.join('.'))")}"
npm version "$version" --no-git-tag-version >/dev/null
git add package.json package-lock.json
git commit -q -m "Release $version"
git push origin main

bash "$repo/scripts/package-mac.sh"

gh release create "v$version" "$repo/dist/mac/Pick-42-mac-arm64.zip" \
  --title "Pick 42 $version" \
  --generate-notes \
  --notes "Unzip and drag **Pick 42** into Applications (macOS on Apple Silicon). First launch: approve the un-notarized build once under System Settings → Privacy & Security → Open Anyway."

echo "Published v$version — the portfolio download now serves this build."
