#!/usr/bin/env bash
# Puts the sherpa-onnx and onnxruntime frameworks in Vendor/sherpa-onnx. They are
# too large to commit, so the pinned archive comes from this Mac's cache or from
# the release it was uploaded to. The podspec runs this on every `pod install`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./versions.sh
source "${SCRIPT_DIR}/versions.sh"

VENDOR_DIR="${MODULE_DIR}/Vendor/sherpa-onnx"
CACHE_DIR="${MAJORDOME_SPEECH_CACHE:-${HOME}/.cache/majordome/sherpa-onnx}"
ARCHIVE="${CACHE_DIR}/${IOS_ARCHIVE_NAME}"

if [[ "$(cat "${VENDOR_DIR}/VERSION" 2>/dev/null)" == "${IOS_ARCHIVE_NAME}" ]]; then
  exit 0
fi

matches() {
  [[ -f "$1" ]] && [[ "$(shasum -a 256 "$1" | cut -d' ' -f1)" == "${IOS_ARCHIVE_SHA256}" ]]
}

if ! matches "${ARCHIVE}"; then
  mkdir -p "${CACHE_DIR}"
  echo "[majordome-speech] downloading ${IOS_ARCHIVE_NAME}" >&2
  curl -fL --retry 3 -o "${ARCHIVE}.part" "${IOS_ARCHIVE_BASE_URL}/${IOS_ARCHIVE_NAME}" || {
    rm -f "${ARCHIVE}.part"
    echo "[majordome-speech] download failed. Build it instead: scripts/build-sherpa-onnx-ios.sh" >&2
    exit 1
  }
  matches "${ARCHIVE}.part" || {
    rm -f "${ARCHIVE}.part"
    echo "[majordome-speech] ${IOS_ARCHIVE_NAME} does not match its checksum" >&2
    exit 1
  }
  mv "${ARCHIVE}.part" "${ARCHIVE}"
fi

rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}"
tar -C "${VENDOR_DIR}" -xJf "${ARCHIVE}"
