#!/usr/bin/env bash
# Builds the Majordome iPhone app and uploads it to TestFlight from this Mac.
#
# Usage: vp run mobile:testflight, or scripts/majordome-testflight.sh [--skip-prebuild]
#
# Reads ~/.majordome/testflight.env (see docs/operations/majordome-testflight.md):
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH   an App Store Connect key (App Manager)
#   ASC_APP_ID                                the app's id in App Store Connect
#   CLERK_PUBLISHABLE_KEY                     the account service's public key
#   DIST_KEYCHAIN, DIST_KEYCHAIN_PASSWORD_ITEM  where the distribution certificate lives
set -euo pipefail

# vp and the repo's Node live here, and are not on every shell's PATH.
export PATH="$HOME/.local/share/vite-plus/bin:$PATH"

CONFIG="${MAJORDOME_TESTFLIGHT_ENV:-$HOME/.majordome/testflight.env}"
[ -f "$CONFIG" ] || { echo "Missing $CONFIG. See docs/operations/majordome-testflight.md." >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"
: "${ASC_KEY_ID:?}" "${ASC_ISSUER_ID:?}" "${ASC_KEY_PATH:?}" "${ASC_APP_ID:?}" "${CLERK_PUBLISHABLE_KEY:?}"
: "${DIST_KEYCHAIN:?}" "${DIST_KEYCHAIN_PASSWORD_ITEM:?}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/majordome-testflight.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
TEAM_ID="5RDKJ8PDGZ"
BUNDLE_ID="io.github.wozacosta.majordome.ios"

export APP_VARIANT=production EXPO_NO_GIT_STATUS=1 CI=1
export T3CODE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY"

if [ "${1:-}" != "--skip-prebuild" ]; then
  echo "Preparing the iOS project..."
  (cd "$MOBILE" && vp exec expo prebuild --clean --platform ios >"$WORK/prebuild.log" 2>&1) ||
    { tail -20 "$WORK/prebuild.log" >&2; exit 1; }
fi

# TestFlight refuses a build number it has seen, so the next one is one past the newest there.
NEXT_BUILD="$(node "$ROOT/scripts/majordome-testflight-build-number.mjs" \
  "$ASC_KEY_PATH" "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$ASC_APP_ID")"
echo "Build number: $NEXT_BUILD"

security unlock-keychain \
  -p "$(security find-generic-password -a majordome -s "$DIST_KEYCHAIN_PASSWORD_ITEM" -w)" \
  "$DIST_KEYCHAIN"

AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID")

echo "Archiving (about ten minutes)..."
(cd "$MOBILE/ios" && xcodebuild -workspace Majordome.xcworkspace -scheme Majordome \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$WORK/Majordome.xcarchive" archive -allowProvisioningUpdates "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$NEXT_BUILD" >"$WORK/archive.log" 2>&1) ||
  { grep -E 'error:' "$WORK/archive.log" | tail -20 >&2; exit 1; }

cat >"$WORK/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>$BUNDLE_ID</key><string>Majordome App Store ios</string>
    <key>$BUNDLE_ID.sharing</key><string>Majordome App Store sharing</string>
  </dict>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "Uploading..."
xcodebuild -exportArchive -archivePath "$WORK/Majordome.xcarchive" -exportPath "$WORK/export" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" "${AUTH[@]}" >"$WORK/export.log" 2>&1 ||
  { grep -E 'error' "$WORK/export.log" | sort -u | tail -20 >&2; exit 1; }

echo "Uploaded build $NEXT_BUILD. Apple takes a few minutes to process it; then it is in TestFlight."
