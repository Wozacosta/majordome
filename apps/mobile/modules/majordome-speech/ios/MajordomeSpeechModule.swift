import CryptoKit
import ExpoModulesCore
import Foundation

struct SpeechLoadOptions: Record {
  @Field var threads: Int?
}

struct SpeechSpeakOptions: Record {
  @Field var voice: Int = 0
  @Field var lang: String = "en"
  @Field var speed: Double?

  var native: SpeakOptions { SpeakOptions(voice: voice, lang: lang, speed: speed) }
}

public class MajordomeSpeechModule: Module {
  private lazy var engine: SpeechEngine = {
    let engine = SpeechEngine()
    engine.onSentenceStarted = { [weak self] id in self?.sendEvent("sentenceStarted", ["id": id]) }
    engine.onDrained = { [weak self] in self?.sendEvent("drained", [:]) }
    engine.onError = { [weak self] message in self?.sendEvent("error", ["message": message]) }
    return engine
  }()

  public func definition() -> ModuleDefinition {
    Name("MajordomeSpeech")

    Events("sentenceStarted", "drained", "error")

    Function("isAvailable") { true }

    AsyncFunction("load") { (directoryUri: URL, options: SpeechLoadOptions) throws -> [String: Int] in
      try self.engine.load(directory: directoryUri, threads: options.threads)
    }

    AsyncFunction("unload") { self.engine.unload() }

    Function("speak") { (text: String, options: SpeechSpeakOptions) -> Int in
      self.engine.speak(text, options.native)
    }

    Function("stop") { self.engine.stop() }

    AsyncFunction("measure") { (text: String, options: SpeechSpeakOptions) throws -> [String: Double] in
      try self.engine.measure(text, options.native)
    }

    // The download is verified here: hashing 145 MB in JavaScript takes most of a minute.
    AsyncFunction("sha256") { (uri: URL) throws -> String in
      let handle = try FileHandle(forReadingFrom: uri)
      defer { try? handle.close() }
      var hasher = SHA256()
      while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
        hasher.update(data: chunk)
      }
      return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    OnDestroy { self.engine.stop() }
  }
}
