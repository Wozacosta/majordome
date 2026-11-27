# Majordome speech

A local Expo module: a voice that speaks on the device. It wraps sherpa-onnx's C API (Supertonic 3)
and plays its own output, so no audio crosses into JavaScript. The JavaScript surface is in
`apps/mobile/src/native/majordomeSpeech.ts`; the voice's files are described by
`packages/client-runtime/src/speaking/voiceCatalog.json` and downloaded by the app on first use.

Android answers "not available" for now: `isAvailable()` is false and the app hides Read aloud.

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

Licences of what ships are in `licenses/` and listed in `third-party-licenses.config.json`.
