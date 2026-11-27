# Pins shared by the build and fetch scripts.
SHERPA_ONNX_TAG="v2.0.3"
SHERPA_ONNX_COMMIT="38016c6e0622e90bf417c35e8b47e0eb805af417"
ONNXRUNTIME_VERSION="1.28.2"
ONNXRUNTIME_ZIP_SHA256="2c2299acbb461d26d4bac4bc85985d40e7c7177ed6072703ae0846d88b0b4599"
IOS_DEPLOYMENT_TARGET="18.0"
IOS_ARCHIVE_NAME="sherpa-onnx-ios-v2.0.3-ort1.28.2-1.tar.xz"
# Printed by build-sherpa-onnx-ios.sh; the archive is uploaded to this release by hand.
IOS_ARCHIVE_SHA256="59c2c03d9ba189d5edb1a1a7c96500f26815d885dd5233e06c2648e10c888806"
IOS_ARCHIVE_BASE_URL="https://github.com/Wozacosta/majordome/releases/download/voice-engine-ios-1"
# sherpa-onnx's own Android build of the same tag; fetch-android.sh keeps two of its ABIs.
ANDROID_AAR_NAME="sherpa-onnx-2.0.3.aar"
ANDROID_AAR_SHA256="4c766e2e74c9d33d595338c21fe3b305c73ba45d47e96a235675c33142a2ec50"
ANDROID_AAR_BASE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3"
ANDROID_ABIS="arm64-v8a armeabi-v7a"
