#!/usr/bin/env bash
# Builds the Majordome Android app as a signed APK on this Mac.
#
# Usage: vp run mobile:apk [--release v1.2.3]
#   --release attaches the APK to that GitHub Release as Majordome.apk.
#
# Reads ~/.majordome/android.env (see docs/operations/majordome-android.md):
#   ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS   the signing key
#   CLERK_PUBLISHABLE_KEY                                            the account service's public key
#   ANDROID_GOOGLE_SERVICES_FILE (optional)                          the Firebase project's
#     google-services.json; without it the app builds and gets no notifications
set -euo pipefail

export PATH="$HOME/.local/share/vite-plus/bin:$PATH"

CONFIG="${MAJORDOME_ANDROID_ENV:-$HOME/.majordome/android.env}"
[ -f "$CONFIG" ] || { echo "Missing $CONFIG. See docs/operations/majordome-android.md." >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"
: "${ANDROID_KEYSTORE:?}" "${ANDROID_KEYSTORE_PASSWORD:?}" "${ANDROID_KEY_ALIAS:?}" "${CLERK_PUBLISHABLE_KEY:?}"

RELEASE=""
[ "${1:-}" = "--release" ] && RELEASE="${2:?--release needs a tag such as v1.2.3}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/apps/mobile"
LOG="$(mktemp -d "${TMPDIR:-/tmp}/majordome-apk.XXXXXX")"

# Gradle needs a JDK and the SDK; Android Studio brings both.
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

# The version people see is the newest release's; the number Android compares counts commits,
# so a later build always installs over an earlier one.
TAG="${RELEASE:-$(git -C "$ROOT" describe --tags --abbrev=0 --match 'v*')}"
export T3CODE_MOBILE_VERSION="${TAG#v}"
export MAJORDOME_ANDROID_VERSION_CODE="$(git -C "$ROOT" rev-list --count HEAD)"
export APP_VARIANT=production EXPO_NO_GIT_STATUS=1 CI=1
export T3CODE_CLERK_PUBLISHABLE_KEY="$CLERK_PUBLISHABLE_KEY"
export MAJORDOME_ANDROID_KEYSTORE="$ANDROID_KEYSTORE"
export MAJORDOME_ANDROID_KEYSTORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
export MAJORDOME_ANDROID_KEY_ALIAS="$ANDROID_KEY_ALIAS"

# Notifications arrive through Google's service, which the app joins with the Firebase project's
# file (docs/operations/majordome-push.md). It is not a secret, and it is not in the repository.
if [ -n "${ANDROID_GOOGLE_SERVICES_FILE:-}" ]; then
  [ -f "$ANDROID_GOOGLE_SERVICES_FILE" ] ||
    { echo "ANDROID_GOOGLE_SERVICES_FILE names no file: $ANDROID_GOOGLE_SERVICES_FILE" >&2; exit 1; }
  export T3CODE_ANDROID_GOOGLE_SERVICES_FILE="$ANDROID_GOOGLE_SERVICES_FILE"
else
  echo "No ANDROID_GOOGLE_SERVICES_FILE in $CONFIG: this build gets no notifications."
fi

echo "Preparing the Android project..."
(cd "$MOBILE" && vp exec expo prebuild --clean --platform android >"$LOG/prebuild.log" 2>&1) ||
  { tail -20 "$LOG/prebuild.log" >&2; exit 1; }

echo "Building $T3CODE_MOBILE_VERSION ($MAJORDOME_ANDROID_VERSION_CODE), about ten minutes..."
(cd "$MOBILE/android" && ./gradlew app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a >"$LOG/build.log" 2>&1) ||
  { grep -E '^e: |What went wrong' -A4 "$LOG/build.log" | tail -30 >&2; echo "Log: $LOG/build.log" >&2; exit 1; }

OUT="$ROOT/release/Majordome.apk"
mkdir -p "$(dirname "$OUT")"
cp "$MOBILE/android/app/build/outputs/apk/release/app-release.apk" "$OUT"
echo "Built $OUT"

if [ -n "$RELEASE" ]; then
  gh release upload "$RELEASE" "$OUT" --clobber --repo Wozacosta/majordome
  echo "Attached to $RELEASE."
fi
