import AVFoundation
import Foundation
import SherpaOnnxC

struct SpeakOptions {
  let voice: Int
  let lang: String
  let speed: Double?
}

enum SpeechFailure: LocalizedError {
  case notLoaded
  case missingFile(String)
  case loadFailed
  case synthesisFailed

  var errorDescription: String? {
    switch self {
    case .notLoaded: return "The voice is not loaded."
    case .missingFile(let name): return "The voice file \(name) is missing."
    case .loadFailed: return "The voice could not be loaded."
    case .synthesisFailed: return "The voice produced no sound."
    }
  }
}

/// Supertonic 3 through sherpa-onnx, played by its own audio engine: one buffer
/// per sentence on a player node, so sentences follow each other without a gap.
final class SpeechEngine {
  var onSentenceStarted: ((Int) -> Void)?
  var onDrained: (() -> Void)?
  var onError: ((String) -> Void)?
  /// Another app, or a phone call, took the audio session.
  var onInterrupted: (() -> Void)?

  /// Synthesis runs here, one sentence at a time. Never block it on `state`.
  private let work = DispatchQueue(label: "majordome.speech.synthesis", qos: .userInitiated)
  /// Guards everything below; audio callbacks arrive on arbitrary threads.
  private let state = NSLock()
  private var tts: OpaquePointer?
  private var directory: URL?
  private var threads = 2
  private var generation = 0
  private var nextId = 0
  /// Sentences accepted and not yet finished playing.
  private var outstanding = 0
  /// Sentences scheduled behind the one being played, in order.
  private var waiting: [Int] = []
  private var playing = false

  private let audio = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private var format: AVAudioFormat?
  private var observers: [NSObjectProtocol] = []

  init() {
    audio.attach(player)
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: nil
    ) { [weak self] note in
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      guard raw == AVAudioSession.InterruptionType.began.rawValue else { return }
      self?.interrupt()
      self?.onInterrupted?()
    })
    // A route change (headphones pulled) stops the engine and drops what was scheduled.
    observers.append(center.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: audio, queue: nil
    ) { [weak self] _ in self?.interrupt() })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    if let tts { SherpaOnnxDestroyOfflineTts(tts) }
  }

  // MARK: - Model

  func load(directory: URL, threads: Int?) throws -> [String: Int] {
    try work.sync {
      try loadOnWork(directory: directory, threads: threads ?? 2)
      return ["voices": Int(SherpaOnnxOfflineTtsNumSpeakers(tts)), "sampleRate": Int(format?.sampleRate ?? 0)]
    }
  }

  func unload() {
    stop()
    work.sync { unloadOnWork() }
  }

  private func unloadOnWork() {
    if let tts { SherpaOnnxDestroyOfflineTts(tts) }
    tts = nil
  }

  private func loadOnWork(directory: URL, threads: Int) throws {
    unloadOnWork()
    let names = [
      "duration_predictor.int8.onnx", "text_encoder.int8.onnx", "vector_estimator.int8.onnx",
      "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin",
    ]
    for name in names where !FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) {
      throw SpeechFailure.missingFile(name)
    }
    // The C structs borrow these strings until the engine is created.
    var owned: [UnsafeMutablePointer<CChar>] = []
    defer { owned.forEach { free($0) } }
    func c(_ value: String) -> UnsafePointer<CChar> {
      let pointer = strdup(value)!
      owned.append(pointer)
      return UnsafePointer(pointer)
    }
    func file(_ name: String) -> UnsafePointer<CChar> { c(directory.appendingPathComponent(name).path) }

    var config = SherpaOnnxOfflineTtsConfig()
    memset(&config, 0, MemoryLayout<SherpaOnnxOfflineTtsConfig>.size)
    config.model.supertonic.duration_predictor = file(names[0])
    config.model.supertonic.text_encoder = file(names[1])
    config.model.supertonic.vector_estimator = file(names[2])
    config.model.supertonic.vocoder = file(names[3])
    config.model.supertonic.tts_json = file(names[4])
    config.model.supertonic.unicode_indexer = file(names[5])
    config.model.supertonic.voice_style = file(names[6])
    config.model.num_threads = Int32(max(1, threads))
    config.model.provider = c("cpu")
    config.max_num_sentences = 1
    guard let created = SherpaOnnxCreateOfflineTts(&config) else { throw SpeechFailure.loadFailed }
    // The files can be downloaded again, so they stay out of the iCloud backup.
    var folder = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? folder.setResourceValues(values)
    tts = created
    self.directory = directory
    self.threads = threads
    let sampleRate = Double(SherpaOnnxOfflineTtsSampleRate(created))
    let next = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)
    if next != format, let next {
      audio.stop()
      audio.connect(player, to: audio.mainMixerNode, format: next)
      format = next
    }
  }

  // MARK: - Speaking

  /// Queues one sentence and returns the number its `sentenceStarted` event carries.
  func speak(_ text: String, _ options: SpeakOptions) -> Int {
    state.lock()
    nextId += 1
    let id = nextId
    let turn = generation
    outstanding += 1
    state.unlock()
    work.async { [self] in
      guard isCurrent(turn) else { return }
      do {
        let buffer = try synthesize(text, options)
        try play(buffer, id: id, turn: turn)
      } catch {
        fail(error, turn: turn)
      }
    }
    return id
  }

  /// Silences at once and forgets everything queued.
  func stop() {
    state.lock()
    generation += 1
    outstanding = 0
    waiting.removeAll()
    playing = false
    state.unlock()
    player.stop()
    audio.stop()
  }

  private func interrupt() {
    state.lock()
    let active = outstanding > 0
    state.unlock()
    guard active else { return }
    stop()
    onDrained?()
  }

  private func isCurrent(_ turn: Int) -> Bool {
    state.lock()
    defer { state.unlock() }
    return turn == generation
  }

  private func fail(_ error: Error, turn: Int) {
    guard isCurrent(turn) else { return }
    stop()
    onError?(error.localizedDescription)
  }

  private func synthesize(_ text: String, _ options: SpeakOptions) throws -> AVAudioPCMBuffer {
    guard let tts, let format else { throw SpeechFailure.notLoaded }
    var config = SherpaOnnxGenerationConfig()
    memset(&config, 0, MemoryLayout<SherpaOnnxGenerationConfig>.size)
    config.sid = Int32(options.voice)
    config.speed = Float(options.speed ?? 0)
    let extra = String(data: try JSONSerialization.data(withJSONObject: ["lang": options.lang]), encoding: .utf8) ?? "{}"
    let audio = extra.withCString { extraPointer -> UnsafePointer<SherpaOnnxGeneratedAudio>? in
      config.extra = extraPointer
      return SherpaOnnxOfflineTtsGenerateWithConfig(tts, text, &config, nil, nil)
    }
    guard let audio else { throw SpeechFailure.synthesisFailed }
    defer { SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio) }
    let count = Int(audio.pointee.n)
    guard count > 0, let samples = audio.pointee.samples,
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
      let channel = buffer.floatChannelData?[0]
    else { throw SpeechFailure.synthesisFailed }
    channel.update(from: samples, count: count)
    buffer.frameLength = AVAudioFrameCount(count)
    return buffer
  }

  private func play(_ buffer: AVAudioPCMBuffer, id: Int, turn: Int) throws {
    state.lock()
    guard turn == generation else {
      state.unlock()
      return
    }
    let first = !playing
    playing = true
    if !first { waiting.append(id) }
    state.unlock()

    if !audio.isRunning { try audio.start() }
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      self?.finished(turn: turn)
    }
    if !player.isPlaying { player.play() }
    if first { onSentenceStarted?(id) }
  }

  private func finished(turn: Int) {
    state.lock()
    guard turn == generation else {
      state.unlock()
      return
    }
    outstanding -= 1
    let next = waiting.isEmpty ? nil : waiting.removeFirst()
    if next == nil { playing = false }
    let drained = outstanding == 0
    state.unlock()
    if let next { onSentenceStarted?(next) }
    guard drained else { return }
    // Off the audio thread: stopping the engine from its own callback deadlocks.
    work.async { [self] in
      guard isCurrent(turn) else { return }
      state.lock()
      let idle = outstanding == 0
      state.unlock()
      guard idle else { return }
      player.stop()
      audio.stop()
      onDrained?()
    }
  }

  // MARK: - Diagnostics

  /// Reloads the voice, speaks `text` once, and reports how long each step took.
  func measure(_ text: String, _ options: SpeakOptions) throws -> [String: Double] {
    stop()
    return try work.sync {
      guard let directory else { throw SpeechFailure.notLoaded }
      unloadOnWork()
      let baselineMemoryMb = Self.memoryFootprintMb()
      var peak = baselineMemoryMb
      let sampler = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
      let peakLock = NSLock()
      sampler.schedule(deadline: .now(), repeating: .milliseconds(20))
      sampler.setEventHandler {
        let now = Self.memoryFootprintMb()
        peakLock.lock()
        peak = max(peak, now)
        peakLock.unlock()
      }
      sampler.resume()
      defer { sampler.cancel() }

      let loadStart = DispatchTime.now()
      try loadOnWork(directory: directory, threads: threads)
      let loadMs = Self.elapsedMs(since: loadStart)

      let start = DispatchTime.now()
      let buffer = try synthesize(text, options)
      let synthMs = Self.elapsedMs(since: start)
      state.lock()
      nextId += 1
      let id = nextId
      let turn = generation
      outstanding += 1
      state.unlock()
      try play(buffer, id: id, turn: turn)
      let firstAudioMs = Self.elapsedMs(since: start)

      peakLock.lock()
      let peakMemoryMb = max(peak, Self.memoryFootprintMb())
      peakLock.unlock()
      return [
        "loadMs": loadMs,
        "firstAudioMs": firstAudioMs,
        "synthMs": synthMs,
        "audioMs": Double(buffer.frameLength) / buffer.format.sampleRate * 1000,
        "peakMemoryMb": peakMemoryMb,
        "baselineMemoryMb": baselineMemoryMb,
      ]
    }
  }

  private static func elapsedMs(since start: DispatchTime) -> Double {
    Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
  }

  /// The figure iOS judges the app by when it decides to end it for memory.
  private static func memoryFootprintMb() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
  }
}
