#!/bin/bash
# Builds a double-clickable "Pick 42.app" that launches the Electron shell from
# THIS checkout — the app always runs current code, so a git pull is the only
# update step. macOS only. Usage: npm run make:launcher [target-dir]
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target_dir="${1:-/Applications}"
[ -w "$target_dir" ] || target_dir="$HOME/Applications"
mkdir -p "$target_dir"
app="$target_dir/Pick 42.app"

electron_bin="$repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$electron_bin" ]; then
  echo "Electron is not installed in this checkout — run npm install first." >&2
  exit 1
fi

# Rasterize the icon into every size iconutil expects.
iconset="$(mktemp -d)/pick42.iconset"
mkdir -p "$iconset"
for size in 16 32 64 128 256 512; do
  sips -z "$size" "$size" "$repo/assets/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$repo/assets/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
iconutil -c icns "$iconset" -o "$app/Contents/Resources/pick42.icns"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Pick 42</string>
  <key>CFBundleDisplayName</key><string>Pick 42</string>
  <key>CFBundleIdentifier</key><string>com.leeloolabs.pick42.launcher</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>pick42</string>
  <key>CFBundleIconFile</key><string>pick42</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

cat > "$app/Contents/MacOS/pick42" <<LAUNCH
#!/bin/bash
exec "$electron_bin" "$repo/src/draft-main.cjs"
LAUNCH
chmod +x "$app/Contents/MacOS/pick42"
touch "$app"

echo "Created $app"
echo "Drag it to the Dock or make a Desktop alias (⌥⌘-drag) for one-click launching."
