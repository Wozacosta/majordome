package expo.modules.majordomespeech

import android.content.Intent
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.security.MessageDigest

class SpeechLoadOptions : Record {
  @Field var threads: Int? = null
}

class SpeechSpeakOptions : Record {
  @Field var voice: Int = 0

  @Field var lang: String = "en"

  @Field var speed: Double? = null

  internal val native get() = SpeakOptions(voice, lang, speed)
}

private val HEADSET_KEYS = setOf(
  KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
  KeyEvent.KEYCODE_MEDIA_PLAY,
  KeyEvent.KEYCODE_MEDIA_PAUSE,
  KeyEvent.KEYCODE_HEADSETHOOK
)

private fun Uri.toFile() = File(requireNotNull(path) { "Not a file: $this" })

class MajordomeSpeechModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val nothing = emptyMap<String, Any>()

  private val lazyEngine = lazy {
    SpeechEngine(requireNotNull(appContext.reactContext).applicationContext).apply {
      onSentenceStarted = { sendEvent("sentenceStarted", mapOf("id" to it)) }
      onDrained = { sendEvent("drained", nothing) }
      onError = { sendEvent("error", mapOf("message" to it)) }
      onInterrupted = { sendEvent("interrupted", nothing) }
    }
  }

  private val engine by lazyEngine

  private var headset: MediaSession? = null

  /** While a conversation is open, the headset's play/pause button reaches JavaScript. */
  private fun listenForHeadsetButton(enabled: Boolean) {
    headset?.release()
    headset = null
    val context = appContext.reactContext
    if (!enabled || context == null) return
    // The system sends the button to the app whose session says it is playing.
    headset = MediaSession(context, "MajordomeSpeech").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onMediaButtonEvent(intent: Intent): Boolean {
          val event = intent.keyEvent()
          if (event == null ||
            event.keyCode !in HEADSET_KEYS
          ) {
            return super.onMediaButtonEvent(intent)
          }
          if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            sendEvent("headsetButton", nothing)
          }
          return true
        }
      })
      setPlaybackState(
        PlaybackState.Builder()
          .setActions(
            PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PLAY or
              PlaybackState.ACTION_PAUSE
          )
          .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
          .build()
      )
      isActive = true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MajordomeSpeech")

    Events("sentenceStarted", "drained", "error", "interrupted", "headsetButton")

    Function("isAvailable") { SpeechEngine.isAvailable }

    AsyncFunction("load") { directoryUri: Uri, options: SpeechLoadOptions ->
      engine.load(directoryUri.toFile(), options.threads)
    }

    AsyncFunction("unload") { engine.unload() }

    Function("speak") { text: String, options: SpeechSpeakOptions ->
      engine.speak(text, options.native)
    }

    Function("stop") { engine.stop() }

    Function("holdAudio") { enabled: Boolean -> engine.holdAudio(enabled) }

    Function("listenForHeadsetButton") { enabled: Boolean ->
      main.post { listenForHeadsetButton(enabled) }
      Unit
    }

    AsyncFunction("measure") { text: String, options: SpeechSpeakOptions ->
      engine.measure(text, options.native)
    }

    // The download is verified here: hashing 145 MB in JavaScript takes most of a minute.
    AsyncFunction("sha256") { uri: Uri ->
      val digest = MessageDigest.getInstance("SHA-256")
      uri.toFile().inputStream().use { stream ->
        val chunk = ByteArray(1 shl 20)
        while (true) {
          val count = stream.read(chunk)
          if (count < 0) break
          digest.update(chunk, 0, count)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }

    OnDestroy {
      if (lazyEngine.isInitialized()) engine.destroy()
      main.post { listenForHeadsetButton(false) }
    }
  }
}

private fun Intent.keyEvent(): KeyEvent? = if (Build.VERSION.SDK_INT >=
  Build.VERSION_CODES.TIRAMISU
) {
  getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
} else {
  @Suppress("DEPRECATION")
  getParcelableExtra(Intent.EXTRA_KEY_EVENT)
}
