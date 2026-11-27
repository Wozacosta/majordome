# Majordome speech

A local Expo module: a voice that speaks on the device. It wraps sherpa-onnx (Supertonic 3) and
plays its own output, so no audio crosses into JavaScript. The JavaScript surface is in
`apps/mobile/src/native/majordomeSpeech.ts`; the voice's files are described by
`packages/client-runtime/src/speaking/voiceCatalog.json` and downloaded by the app on first use.

`isAvailable()` is false on a build without the libraries for the phone's processor (an x86
Android emulator); the app then hides Read aloud and talking.

## The iOS frameworks

sherpa-onnx publishes no iOS binary, and the two static frameworks (sherpa-onnx and onnxruntime,
131 MB unpacked) are too large to commit. `Vendor/` is ignored. The podspec runs
`scripts/fetch-ios.sh` on every `pod install`, which takes the pinned archive (17 MB) from
`~/.cache/majordome/sherpa-onnx/`, or downloads it from the release named in `scripts/versions.sh`,
and checks its SHA-256 either way.

To rebuild after changing a pin in `scripts/versions.sh` (needs `cmake`; about ten minutes):

```bash
apps/mobile/modules/majordome-speech/scripts/build-sherpa-onnx-ios.sh
```

It builds the iPhone and Apple-silicon simulator slices, writes the archive and prints its
SHA-256. Put that in `IOS_ARCHIVE_SHA256`, copy the archive to `~/.cache/majordome/sherpa-onnx/`,
and upload it to the release so other machines can fetch it.

## The Android libraries

sherpa-onnx publishes an Android AAR with its Kotlin API. `android/build.gradle` runs
`scripts/fetch-android.sh` before every build: it takes the AAR pinned in `scripts/versions.sh`
from the same cache, or from sherpa-onnx's release, checks its SHA-256, and unpacks the classes and
the two libraries the engine needs (`libsherpa-onnx-jni.so`, `libonnxruntime.so`) for the ABIs in
`ANDROID_ABIS` into `Vendor/android`. Keep `ANDROID_ABIS` equal to what
`scripts/majordome-android-apk.sh` builds.

On Android the engine also owns the audio focus (`SpeechAudio.kt`): it takes it to speak, and
`holdAudio(true)` keeps it for a whole conversation so music does not come back while the phone
listens. Expo Audio must not ask for the focus meanwhile, which is why the conversation's audio
session mixes (`apps/mobile/src/lib/audioSession.ts`).

Licences of what ships are in `licenses/` and listed in `third-party-licenses.config.json`.
