package expo.modules.majordomespeech

import android.content.Context
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

internal class SpeakOptions(val voice: Int, val lang: String, val speed: Double?)

internal class SpeechFailure(message: String) : CodedException("ERR_SPEECH", message, null)

private class Sentence(
  val samples: FloatArray,
  val id: Int,
  val turn: Int,
  /** Counted down when the sentence reaches the speaker, for `measure`. */
  val started: CountDownLatch? = null
)

private val VOICE_FILES = listOf(
  "duration_predictor.int8.onnx",
  "text_encoder.int8.onnx",
  "vector_estimator.int8.onnx",
  "vocoder.int8.onnx",
  "tts.json",
  "unicode_indexer.bin",
  "voice.bin"
)

/**
 * Supertonic 3 through sherpa-onnx, played by its own track: sentences are
 * synthesized one at a time and written one after the other, so they follow
 * each other without a gap. The iPhone's `SpeechEngine.swift`, in Kotlin.
 */
internal class SpeechEngine(context: Context) {
  var onSentenceStarted: (Int) -> Unit = {}
  var onDrained: () -> Unit = {}
  var onError: (String) -> Unit = {}

  /** Another app, or a phone call, took the audio. */
  var onInterrupted: () -> Unit = {}

  /** Synthesis runs here, one sentence at a time. Never block it on `state`. */
  private val work = Executors.newSingleThreadExecutor { Thread(it, "majordome-speech-synthesis") }

  /** Guards the counters below; callbacks arrive on arbitrary threads. */
  private val state = Any()
  private var generation = 0
  private var nextId = 0

  /** Sentences accepted and not yet finished playing. */
  private var outstanding = 0

  // Only touched on `work`.
  private var tts: OfflineTts? = null
  private var directory: File? = null
  private var threads = 2

  @Volatile private var sampleRate = 0

  private val audio = SpeechAudio(
    context,
    onFocusLost = {
      interrupt()
      onInterrupted()
    },
    onNoisy = ::interrupt
  )
  private val synthesized = LinkedBlockingQueue<Sentence>()
  private val player = thread(name = "majordome-speech-playback", isDaemon = true) { playLoop() }

  // MARK: - Model

  fun load(directory: File, threads: Int?): Map<String, Int> = onWork {
    val loaded = loadOnWork(directory, threads ?: 2)
    mapOf("voices" to loaded.numSpeakers(), "sampleRate" to loaded.sampleRate())
  }

  fun unload() {
    stop()
    onWork { unloadOnWork() }
  }

  /** Ends the engine for good: the module is going away. */
  fun destroy() {
    stop()
    work.execute { unloadOnWork() }
    work.shutdown()
    player.interrupt()
    audio.release()
  }

  private fun unloadOnWork() {
    tts?.release()
    tts = null
  }

  private fun loadOnWork(directory: File, threads: Int): OfflineTts {
    unloadOnWork()
    VOICE_FILES.firstOrNull { !File(directory, it).exists() }?.let {
      throw SpeechFailure("The voice file $it is missing.")
    }
    val file = { index: Int -> File(directory, VOICE_FILES[index]).path }
    val config = OfflineTtsConfig(
      model = OfflineTtsModelConfig(
        supertonic = OfflineTtsSupertonicModelConfig(
          durationPredictor = file(0),
          textEncoder = file(1),
          vectorEstimator = file(2),
          vocoder = file(3),
          ttsJson = file(4),
          unicodeIndexer = file(5),
          voiceStyle = file(6)
        ),
        numThreads = maxOf(1, threads),
        provider = "cpu"
      ),
      maxNumSentences = 1
    )
    val created = try {
      OfflineTts(config = config)
    } catch (error: IllegalArgumentException) {
      throw SpeechFailure("The voice could not be loaded.").apply { initCause(error) }
    }
    tts = created
    this.directory = directory
    this.threads = threads
    sampleRate = created.sampleRate()
    return created
  }

  // MARK: - Speaking

  /** Queues one sentence and returns the number its `sentenceStarted` event carries. */
  fun speak(text: String, options: SpeakOptions): Int {
    val (id, turn) = accept()
    work.execute {
      if (isCurrent(turn)) {
        try {
          synthesized.put(Sentence(synthesize(text, options), id, turn))
        } catch (error: SpeechFailure) {
          fail(error, turn)
        }
      }
    }
    return id
  }

  /** Silences at once and forgets everything queued. */
  fun stop() {
    synchronized(state) {
      generation += 1
      outstanding = 0
    }
    synthesized.clear()
    audio.silence()
  }

  /** Keeps the audio to this app between sentences; false when the system refuses. */
  fun holdAudio(enabled: Boolean) = audio.hold(enabled)

  private fun accept(): Pair<Int, Int> = synchronized(state) {
    nextId += 1
    outstanding += 1
    nextId to generation
  }

  private fun interrupt() {
    if (synchronized(state) { outstanding > 0 }) {
      stop()
      onDrained()
    }
  }

  private fun isCurrent(turn: Int) = synchronized(state) { turn == generation }

  private fun fail(error: SpeechFailure, turn: Int) {
    if (isCurrent(turn)) {
      stop()
      onError(error.message ?: "The voice stopped.")
    }
  }

  private fun synthesize(text: String, options: SpeakOptions): FloatArray {
    val engine = tts ?: throw SpeechFailure("The voice is not loaded.")
    val config = GenerationConfig(
      speed = options.speed?.takeIf { it > 0 }?.toFloat() ?: 1f,
      sid = options.voice,
      extra = mapOf("lang" to options.lang)
    )
    return engine.generateWithConfig(text, config).samples.takeIf { it.isNotEmpty() }
      ?: throw SpeechFailure("The voice produced no sound.")
  }

  private fun playLoop() {
    try {
      while (true) {
        val sentence = synthesized.take()
        try {
          play(sentence)
        } catch (error: SpeechFailure) {
          fail(error, sentence.turn)
        }
      }
    } catch (_: InterruptedException) {
      // `destroy` ends the loop.
    }
  }

  private fun play(sentence: Sentence) {
    if (!isCurrent(sentence.turn)) return
    audio.begin(sampleRate)
    onSentenceStarted(sentence.id)
    sentence.started?.countDown()
    if (audio.write(sentence.samples) { isCurrent(sentence.turn) }) finished(sentence.turn)
  }

  private fun finished(turn: Int) {
    val idle = { synchronized(state) { turn == generation && outstanding == 0 } }
    synchronized(state) { if (turn == generation) outstanding -= 1 }
    if (!idle()) return
    // A sentence queued meanwhile keeps the track going, with no `drained` in between.
    audio.awaitPlayedOut(idle)
    if (!idle()) return
    audio.silence()
    onDrained()
  }

  // MARK: - Diagnostics

  /** Reloads the voice, speaks `text` once, and reports how long each step took. */
  fun measure(text: String, options: SpeakOptions): Map<String, Double> {
    stop()
    return onWork {
      val directory = directory ?: throw SpeechFailure("The voice is not loaded.")
      unloadOnWork()
      val baseline = residentBytes()
      val peak = AtomicLong(baseline)
      val sampler = Executors.newSingleThreadScheduledExecutor()
      sampler.scheduleAtFixedRate({
        peak.accumulateAndGet(residentBytes(), ::maxOf)
      }, 0, 20, TimeUnit.MILLISECONDS)
      try {
        val loadStart = SystemClock.elapsedRealtimeNanos()
        loadOnWork(directory, threads)
        val loadMs = elapsedMs(loadStart)

        val start = SystemClock.elapsedRealtimeNanos()
        val samples = synthesize(text, options)
        val synthMs = elapsedMs(start)
        val (id, turn) = accept()
        val started = CountDownLatch(1)
        synthesized.put(Sentence(samples, id, turn, started))
        started.await(2, TimeUnit.SECONDS)
        val firstAudioMs = elapsedMs(start)

        mapOf(
          "loadMs" to loadMs,
          "firstAudioMs" to firstAudioMs,
          "synthMs" to synthMs,
          "audioMs" to samples.size * 1000.0 / sampleRate,
          "peakMemoryMb" to maxOf(peak.get(), residentBytes()) / MEGABYTE,
          "baselineMemoryMb" to baseline / MEGABYTE
        )
      } finally {
        sampler.shutdownNow()
      }
    }
  }

  private fun <T> onWork(block: () -> T): T = try {
    work.submit(Callable(block)).get()
  } catch (error: ExecutionException) {
    throw error.cause ?: error
  }

  companion object {
    private const val MEGABYTE = 1_048_576.0

    /** False on a build without the libraries for this phone's processor. */
    val isAvailable: Boolean by lazy {
      runCatching { System.loadLibrary("sherpa-onnx-jni") }.isSuccess
    }

    private fun elapsedMs(since: Long) = (SystemClock.elapsedRealtimeNanos() - since) / 1_000_000.0

    /** The memory the app holds in RAM: what Android weighs when it looks for an app to end. */
    private fun residentBytes(): Long = runCatching {
      val pages = File("/proc/self/statm").readText().split(' ')[1].toLong()
      pages * Os.sysconf(OsConstants._SC_PAGESIZE)
    }.getOrDefault(0)
  }
}
