#!/usr/bin/env bash
# Puts sherpa-onnx's Kotlin classes and native libraries in Vendor/android. They are
# too large to commit, so the pinned AAR comes from this machine's cache or from
# sherpa-onnx's release. Gradle runs this before every build (android/build.gradle).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./versions.sh
source "${SCRIPT_DIR}/versions.sh"

VENDOR_DIR="${MODULE_DIR}/Vendor/android"
CACHE_DIR="${MAJORDOME_SPEECH_CACHE:-${HOME}/.cache/majordome/sherpa-onnx}"
ARCHIVE="${CACHE_DIR}/${ANDROID_AAR_NAME}"
VERSION="${ANDROID_AAR_SHA256} ${ANDROID_ABIS}"

if [[ "$(cat "${VENDOR_DIR}/VERSION" 2>/dev/null)" == "${VERSION}" ]]; then
  exit 0
fi

matches() {
  [[ -f "$1" ]] && [[ "$(shasum -a 256 "$1" | cut -d' ' -f1)" == "${ANDROID_AAR_SHA256}" ]]
}

if ! matches "${ARCHIVE}"; then
  mkdir -p "${CACHE_DIR}"
  echo "[majordome-speech] downloading ${ANDROID_AAR_NAME}" >&2
  curl -fL --retry 3 -o "${ARCHIVE}.part" "${ANDROID_AAR_BASE_URL}/${ANDROID_AAR_NAME}" || {
    rm -f "${ARCHIVE}.part"
    echo "[majordome-speech] could not download ${ANDROID_AAR_NAME}" >&2
    exit 1
  }
  matches "${ARCHIVE}.part" || {
    rm -f "${ARCHIVE}.part"
    echo "[majordome-speech] ${ANDROID_AAR_NAME} does not match its checksum" >&2
    exit 1
  }
  mv "${ARCHIVE}.part" "${ARCHIVE}"
fi

rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}"
unzip -q -o "${ARCHIVE}" classes.jar -d "${VENDOR_DIR}"
mv "${VENDOR_DIR}/classes.jar" "${VENDOR_DIR}/sherpa-onnx.jar"
# The JNI library needs onnxruntime and nothing else; the C and C++ API libraries stay out.
for abi in ${ANDROID_ABIS}; do
  mkdir -p "${VENDOR_DIR}/jniLibs/${abi}"
  unzip -q -o -j "${ARCHIVE}" \
    "jni/${abi}/libsherpa-onnx-jni.so" "jni/${abi}/libonnxruntime.so" \
    -d "${VENDOR_DIR}/jniLibs/${abi}"
done
echo "${VERSION}" > "${VENDOR_DIR}/VERSION"
