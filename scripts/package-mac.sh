#!/bin/bash
# Assemble a self-contained "Pick 42.app" (Apple Silicon) from this checkout's
# Electron dist plus the app source, ad-hoc sign it, and zip it for release.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo/dist/mac"
app="$out/Pick 42.app"
zip="$out/Pick-42-mac-arm64.zip"
version="$(node -e "process.stdout.write(require('$repo/package.json').version)")"

rm -rf "$out"
mkdir -p "$out"

# 1. Copy the Electron shell (ditto preserves the framework symlinks).
ditto "$repo/node_modules/electron/dist/Electron.app" "$app"
rm -f "$app/Contents/Resources/default_app.asar"

# 2. Brand icon: rasterize the repo icon into an icns, replacing Electron's.
iconset="$(mktemp -d)/pick42.iconset"
mkdir -p "$iconset"
for size in 16 32 64 128 256 512; do
  sips -z "$size" "$size" "$repo/assets/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$repo/assets/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/electron.icns"

# 3. Identity in Info.plist.
plist="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Pick 42" "$plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Pick 42" "$plist" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Pick 42" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.leeloolabs.pick42" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$plist"

# 4. App payload: the same layout as the checkout, so projectRoot-relative
#    paths (fixtures, assets, bin) keep resolving.
payload="$app/Contents/Resources/app"
mkdir -p "$payload/node_modules/lucide/dist/umd"
ditto "$repo/src" "$payload/src"
ditto "$repo/assets" "$payload/assets"
ditto "$repo/fixtures" "$payload/fixtures"
ditto "$repo/bin" "$payload/bin"
cp "$repo/node_modules/lucide/dist/umd/lucide.min.js" "$payload/node_modules/lucide/dist/umd/"
cat > "$payload/package.json" <<PKG
{
  "name": "pick-42",
  "productName": "Pick 42",
  "version": "$version",
  "main": "src/draft-main.cjs",
  "author": "Leeloo Labs LLC",
  "description": "A local-first draft and deck-building companion for MTG Arena."
}
PKG

# 5. Ad-hoc sign so Apple Silicon will execute the modified bundle. Finder
#    metadata (xattrs) on copied files breaks signing, so strip it first.
xattr -cr "$app"
codesign --force --deep --sign - "$app" 2>&1 | grep -v "replacing existing signature" || true
codesign --verify --deep "$app"

# 6. Zip for release (ditto keeps bundle structure and permissions).
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
echo "Built $zip"
du -sh "$app" "$zip"
