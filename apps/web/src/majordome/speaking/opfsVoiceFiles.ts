import type { VoiceFiles } from "@t3tools/client-runtime/speaking/voice-store";

const missing = (error: unknown) => error instanceof DOMException && error.name === "NotFoundError";

async function fileOf(folder: Promise<FileSystemDirectoryHandle>, name: string) {
  try {
    return await (await (await folder).getFileHandle(name)).getFile();
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

/**
 * The voice's folder in the browser's private storage (OPFS), which a browser may empty when
 * the disk runs short: every call looks at what is really there.
 */
export function createOpfsVoiceFiles(
  openFolder: () => Promise<FileSystemDirectoryHandle>,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): VoiceFiles {
  const remove = async (name: string) => {
    try {
      await (await openFolder()).removeEntry(name);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  };
  return {
    size: async (name) => (await fileOf(openFolder(), name))?.size ?? null,
    sha256: async (name) => {
      const file = await fileOf(openFolder(), name);
      if (!file) return "";
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    fetchInto: async ({ url, name, offset, signal, onBytes }) => {
      const response = await fetcher(url, {
        signal,
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      });
      if (response.status !== 200 && response.status !== 206) {
        await response.body?.cancel();
        return { status: response.status };
      }
      if (!response.body) throw new Error("The download has no body.");
      const handle = await (await openFolder()).getFileHandle(name, { create: true });
      const resumed = response.status === 206;
      const writable = await handle.createWritable({ keepExistingData: resumed });
      const reader = response.body.getReader();
      try {
        if (resumed) await writable.seek(offset);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          onBytes(value.byteLength);
        }
      } finally {
        // Closing is what saves the bytes, so a dropped download keeps them and resumes.
        await writable.close();
      }
      return { status: response.status };
    },
    rename: async (from, to) => {
      const folder = await openFolder();
      await remove(to);
      const handle = await folder.getFileHandle(from);
      if ("move" in handle && typeof handle.move === "function") {
        await handle.move(to);
        return;
      }
      const target = await (await folder.getFileHandle(to, { create: true })).createWritable();
      await (await handle.getFile()).stream().pipeTo(target);
      await folder.removeEntry(from);
    },
    remove,
  };
}
