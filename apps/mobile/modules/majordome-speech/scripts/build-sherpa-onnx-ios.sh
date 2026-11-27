#!/usr/bin/env bash
# Builds sherpa-onnx's C API and the matching onnxruntime as two static
# xcframeworks (iPhone arm64, simulator arm64) and packs them into the archive
# that scripts/fetch-ios.sh downloads. sherpa-onnx publishes no iOS binary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./versions.sh
source "${SCRIPT_DIR}/versions.sh"

VENDOR_DIR="${MODULE_DIR}/Vendor/sherpa-onnx"
WORK_DIR="${SHERPA_ONNX_WORK_DIR:-${HOME}/.cache/majordome/sherpa-onnx-${SHERPA_ONNX_TAG}}"
SOURCE_DIR="${SHERPA_ONNX_SOURCE_DIR:-${WORK_DIR}/src}"
BUILD_DIR="${WORK_DIR}/build-ios"
JOBS="${SHERPA_ONNX_JOBS:-$(sysctl -n hw.ncpu)}"

log() { printf '[sherpa-onnx-ios] %s\n' "$*"; }
die() { printf '[sherpa-onnx-ios] error: %s\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

require_cmd git
require_cmd cmake
require_cmd curl
require_cmd unzip
require_cmd xcodebuild
require_cmd libtool
require_cmd lipo

if [[ ! -d "${SOURCE_DIR}/.git" ]]; then
  log "cloning sherpa-onnx ${SHERPA_ONNX_TAG}"
  mkdir -p "$(dirname "${SOURCE_DIR}")"
  git clone --depth 1 --branch "${SHERPA_ONNX_TAG}" https://github.com/k2-fsa/sherpa-onnx "${SOURCE_DIR}"
fi
[[ "$(git -C "${SOURCE_DIR}" rev-parse HEAD)" == "${SHERPA_ONNX_COMMIT}" ]] \
  || die "${SOURCE_DIR} is not at ${SHERPA_ONNX_TAG} (${SHERPA_ONNX_COMMIT})"

mkdir -p "${BUILD_DIR}"
ORT_DIR="${BUILD_DIR}/onnxruntime-${ONNXRUNTIME_VERSION}"
if [[ ! -d "${ORT_DIR}/onnxruntime.xcframework" ]]; then
  log "downloading onnxruntime ${ONNXRUNTIME_VERSION}"
  mkdir -p "${ORT_DIR}"
  ort_zip="${ORT_DIR}/onnxruntime.zip"
  curl -fL --retry 3 -o "${ort_zip}" \
    "https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime-ios-static-xcframework-${ONNXRUNTIME_VERSION}.xcframework.zip"
  echo "${ONNXRUNTIME_ZIP_SHA256}  ${ort_zip}" | shasum -a 256 -c - >/dev/null \
    || die "onnxruntime archive does not match its checksum"
  unzip -q "${ort_zip}" -d "${ORT_DIR}"
  rm "${ort_zip}"
fi

build_slice() {
  local platform="$1" name="$2" ort_slice="$3"
  export SHERPA_ONNXRUNTIME_LIB_DIR="${ORT_DIR}/onnxruntime.xcframework/${ort_slice}"
  export SHERPA_ONNXRUNTIME_INCLUDE_DIR="${SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.framework/Headers"
  log "building ${name}"
  cmake -S "${SOURCE_DIR}" -B "${BUILD_DIR}/${name}" \
    -DCMAKE_TOOLCHAIN_FILE="${SOURCE_DIR}/toolchains/ios.toolchain.cmake" \
    -DPLATFORM="${platform}" \
    -DENABLE_BITCODE=0 \
    -DENABLE_ARC=1 \
    -DENABLE_VISIBILITY=0 \
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DCMAKE_INSTALL_PREFIX="${BUILD_DIR}/${name}/install" \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DBUILD_SHARED_LIBS=OFF \
    -DSHERPA_ONNX_ENABLE_PYTHON=OFF \
    -DSHERPA_ONNX_ENABLE_BINARY=OFF \
    -DSHERPA_ONNX_ENABLE_TESTS=OFF \
    -DSHERPA_ONNX_ENABLE_CHECK=OFF \
    -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \
    -DSHERPA_ONNX_ENABLE_JNI=OFF \
    -DSHERPA_ONNX_ENABLE_C_API=ON \
    -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF \
    -DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF \
    -DSHERPA_ONNX_ENABLE_TTS=ON \
    -DDEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET}" >/dev/null
  cmake --build "${BUILD_DIR}/${name}" -j "${JOBS}"
  cmake --build "${BUILD_DIR}/${name}" --target install >/dev/null
}

# One static archive per slice, wrapped as a framework so Swift can import it.
make_framework() {
  local name="$1" fw="${BUILD_DIR}/$1/SherpaOnnxC.framework"
  rm -rf "${fw}"
  mkdir -p "${fw}/Headers/sherpa-onnx/c-api" "${fw}/Modules"
  # shellcheck disable=SC2046
  libtool -static -o "${fw}/SherpaOnnxC" $(find "${BUILD_DIR}/${name}/lib" -name '*.a' | sort) 2>/dev/null
  strip -S "${fw}/SherpaOnnxC" 2>/dev/null
  cp "${BUILD_DIR}/${name}/install/include/sherpa-onnx/c-api/c-api.h" "${fw}/Headers/sherpa-onnx/c-api/"
  cat > "${fw}/Modules/module.modulemap" <<'EOF'
framework module SherpaOnnxC {
  header "sherpa-onnx/c-api/c-api.h"
  export *
}
EOF
  cat > "${fw}/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.k2-fsa.sherpa-onnx</string>
  <key>CFBundleName</key><string>SherpaOnnxC</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleExecutable</key><string>SherpaOnnxC</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>${SHERPA_ONNX_TAG#v}</string>
  <key>MinimumOSVersion</key><string>${IOS_DEPLOYMENT_TARGET}</string>
</dict>
</plist>
EOF
}

build_slice SIMULATORARM64 simulator ios-arm64_x86_64-simulator
build_slice OS64 device ios-arm64
make_framework simulator
make_framework device

log "assembling xcframeworks"
rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}"
xcodebuild -create-xcframework \
  -framework "${BUILD_DIR}/device/SherpaOnnxC.framework" \
  -framework "${BUILD_DIR}/simulator/SherpaOnnxC.framework" \
  -output "${VENDOR_DIR}/SherpaOnnxC.xcframework" >/dev/null

# onnxruntime ships an Intel simulator slice the app never builds; drop it.
ORT_SIM="${BUILD_DIR}/onnxruntime-simulator/onnxruntime.framework"
rm -rf "${BUILD_DIR}/onnxruntime-simulator"
mkdir -p "$(dirname "${ORT_SIM}")"
cp -R "${ORT_DIR}/onnxruntime.xcframework/ios-arm64_x86_64-simulator/onnxruntime.framework" "${ORT_SIM}"
lipo "${ORT_SIM}/onnxruntime" -thin arm64 -output "${ORT_SIM}/onnxruntime"
xcodebuild -create-xcframework \
  -framework "${ORT_DIR}/onnxruntime.xcframework/ios-arm64/onnxruntime.framework" \
  -framework "${ORT_SIM}" \
  -output "${VENDOR_DIR}/onnxruntime.xcframework" >/dev/null

cp "${SOURCE_DIR}/LICENSE" "${VENDOR_DIR}/LICENSE.sherpa-onnx"
printf '%s\n' "${IOS_ARCHIVE_NAME}" > "${VENDOR_DIR}/VERSION"

ARCHIVE="${WORK_DIR}/${IOS_ARCHIVE_NAME}"
rm -f "${ARCHIVE}"
tar -C "${VENDOR_DIR}" -cJf "${ARCHIVE}" .
log "wrote ${ARCHIVE}"
log "sha256 $(shasum -a 256 "${ARCHIVE}" | cut -d' ' -f1)"
du -sh "${VENDOR_DIR}"/*.xcframework "${ARCHIVE}"
