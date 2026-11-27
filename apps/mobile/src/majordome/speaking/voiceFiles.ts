import type { VoiceFiles } from "@t3tools/client-runtime/speaking/voice-store";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { fetch } from "expo/fetch";

/** The voice's folder in the app's documents, one per catalog id so sets never mix. */
export function voiceDirectory(catalogId: string): Directory {
  return new Directory(Paths.document, "voices", catalogId);
}

export function createVoiceFiles(
  directory: Directory,
  sha256: (fileUri: string) => Promise<string>,
): VoiceFiles {
  const file = (name: string) => new File(directory, name);
  return {
    size: async (name) => {
      const target = file(name);
      return target.exists ? target.size : null;
    },
    sha256: (name) => sha256(file(name).uri),
    fetchInto: async ({ url, name, offset, signal, onBytes }) => {
      const response = await fetch(url, {
        signal,
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      });
      if (response.status !== 200 && response.status !== 206) return { status: response.status };
      if (!response.body) throw new Error("The download has no body.");
      directory.create({ intermediates: true, idempotent: true });
      const target = file(name);
      if (!target.exists) target.create();
      const handle = target.open(response.status === 206 ? FileMode.Append : FileMode.Truncate);
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          handle.writeBytesSync(value);
          onBytes(value.byteLength);
        }
      } finally {
        handle.close();
      }
      return { status: response.status };
    },
    rename: async (from, to) => {
      const target = file(to);
      if (target.exists) target.delete();
      file(from).move(target);
    },
    remove: async (name) => {
      const target = file(name);
      if (target.exists) target.delete();
    },
  };
}
