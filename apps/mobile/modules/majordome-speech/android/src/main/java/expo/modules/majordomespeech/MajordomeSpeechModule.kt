package expo.modules.majordomespeech

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class SpeechUnavailable :
  CodedException(
    "ERR_SPEECH_UNAVAILABLE",
    "The on-device voice is not available on Android yet.",
    null,
  )

// A lambda that only throws returns Nothing, which Expo's function builders cannot take.
private fun unavailable(): Any? = throw SpeechUnavailable()

/**
 * The same surface as the iPhone module, answering "not available": the app
 * hides Read aloud when `isAvailable()` is false. The sherpa-onnx AAR and an
 * AudioTrack player go here.
 */
class MajordomeSpeechModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MajordomeSpeech")

    Events("sentenceStarted", "drained", "error", "interrupted", "headsetButton")

    Function("isAvailable") { false }

    AsyncFunction("load") { _: String, _: Map<String, Any?> -> unavailable() }

    AsyncFunction("unload") { }

    Function("speak") { _: String, _: Map<String, Any?> -> unavailable() }

    Function("stop") { }

    Function("listenForHeadsetButton") { _: Boolean -> }

    AsyncFunction("measure") { _: String, _: Map<String, Any?> -> unavailable() }

    AsyncFunction("sha256") { _: String -> unavailable() }
  }
}
