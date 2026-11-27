package expo.modules.majordomespeech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock

private const val BUFFER_MS = 200
private const val CHUNK_FRAMES = 2048
private const val POLL_MS = 10L

// The head position counts what the mixer took; the speaker is this far behind it.
private const val OUTPUT_TAIL_MS = 120L

/**
 * The sound's way out: one streaming track fed a sentence at a time, and the
 * audio focus that goes with it. Every call is safe from any thread.
 */
internal class SpeechAudio(
  private val context: Context,
  /** Another app, or a phone call, took the audio. */
  private val onFocusLost: () -> Unit,
  /** The headphones were pulled: what follows would come out of the speaker. */
  private val onNoisy: () -> Unit
) {
  private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val lock = Any()
  private var track: AudioTrack? = null
  private var written = 0L
  private var focused = false
  private var held = false
  private var request: AudioFocusRequest? = null

  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
    ) {
      // Given up for good: the voice does not start again by itself when the call ends.
      synchronized(lock) { abandonFocus() }
      onFocusLost()
    }
  }

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = onNoisy()
  }

  init {
    val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(noisyReceiver, filter)
    }
  }

  /**
   * Keeps the audio focus between sentences, for a conversation: music must not
   * come back while the phone listens. False when the focus is refused.
   */
  fun hold(enabled: Boolean): Boolean = synchronized(lock) {
    held = enabled
    if (enabled) {
      requestFocus()
    } else {
      if (track == null) abandonFocus()
      true
    }
  }

  /** Takes the focus and starts the track; the next `write` is heard. */
  fun begin(sampleRate: Int) = synchronized(lock) {
    if (!requestFocus()) throw SpeechFailure("The voice could not take the audio.")
    val current = track?.takeIf { it.sampleRate == sampleRate } ?: open(sampleRate)
    if (current.playState != AudioTrack.PLAYSTATE_PLAYING) current.play()
  }

  /**
   * Plays `samples` after what is already queued. Returns false, having stopped
   * writing, as soon as `current` says the sentence was cancelled.
   */
  fun write(samples: FloatArray, current: () -> Boolean): Boolean {
    var offset = 0
    var alive = true
    while (alive && offset < samples.size) {
      val count = synchronized(lock) {
        val active = track
        // Checked under the lock `silence` takes, so nothing is written after a flush.
        if (active == null || !current()) {
          null
        } else {
          active.write(
            samples,
            offset,
            minOf(CHUNK_FRAMES, samples.size - offset),
            AudioTrack.WRITE_NON_BLOCKING
          ).also { if (it > 0) written += it }
        }
      }
      when {
        count == null -> alive = false
        count < 0 -> throw SpeechFailure("The voice could not play.")
        count == 0 -> Thread.sleep(POLL_MS)
        else -> offset += count
      }
    }
    return alive
  }

  /** Returns once everything written has come out, or `waiting` turns false. */
  fun awaitPlayedOut(waiting: () -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + BUFFER_MS + 1000
    while (waiting() && SystemClock.uptimeMillis() < deadline) {
      val played = synchronized(lock) {
        // The position is an unsigned 32-bit count of frames.
        track?.let { (it.playbackHeadPosition.toLong() and 0xFFFFFFFFL) >= written } ?: true
      }
      if (played) {
        Thread.sleep(OUTPUT_TAIL_MS)
        return
      }
      Thread.sleep(POLL_MS)
    }
  }

  /** Silences at once and drops what was queued. */
  fun silence() = synchronized(lock) {
    track?.let {
      runCatching {
        it.pause()
        it.flush()
      }
      it.release()
    }
    track = null
    written = 0
    if (!held) abandonFocus()
  }

  fun release() {
    synchronized(lock) { held = false }
    silence()
    runCatching { context.unregisterReceiver(noisyReceiver) }
  }

  private fun open(sampleRate: Int): AudioTrack {
    track?.release()
    track = null
    written = 0
    val encoding = AudioFormat.ENCODING_PCM_FLOAT
    val smallest = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, encoding)
    val created = AudioTrack.Builder()
      .setAudioAttributes(attributes)
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(encoding)
          .build()
      )
      .setBufferSizeInBytes(maxOf(smallest, sampleRate * BUFFER_MS / 1000 * Float.SIZE_BYTES))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    if (created.state != AudioTrack.STATE_INITIALIZED) {
      created.release()
      throw SpeechFailure("The voice could not play.")
    }
    track = created
    return created
  }

  private fun requestFocus(): Boolean {
    if (focused) return true
    // Transient: the music this interrupts comes back afterwards.
    val gain = AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val next = AudioFocusRequest.Builder(gain)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(focusListener)
        .build()
      request = next
      manager.requestAudioFocus(next)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, gain)
    }
    focused = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    return focused
  }

  private fun abandonFocus() {
    if (!focused) return
    focused = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      request?.let { manager.abandonAudioFocusRequest(it) }
      request = null
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(focusListener)
    }
  }
}
