import type { VoiceCatalog } from "@t3tools/client-runtime/speaking/voice-catalog";
import { createVoiceStore } from "@t3tools/client-runtime/speaking/voice-store";
import { describe, expect, it } from "vite-plus/test";

import { createOpfsVoiceFiles } from "./opfsVoiceFiles";
import { voiceFolder } from "./voiceFolder";

const BODY = new TextEncoder().encode("0123456789abcdefghij");
// SHA-256 of BODY.
const BODY_SHA = "5e41e2a7d1a4d6f5f1b3a1e0a3b0b0b3c2a1f0e9d8c7b6a5f4e3d2c1b0a99887";

const hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

/** A host that honours ranges, and can drop the connection part-way. */
function host(body = BODY) {
  const asked: Array<string | null> = [];
  let dropAfter: number | null = null;
  let ignoreRanges = false;
  const fetcher: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("range");
    asked.push(range);
    const from = range && !ignoreRanges ? Number(/^bytes=(\d+)-$/.exec(range)![1]) : 0;
    const rest = body.slice(from);
    const cut = dropAfter;
    dropAfter = null;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      // One chunk per pull: erroring a stream throws away what it has not handed over yet.
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(cut === null ? rest : rest.slice(0, cut));
        } else if (cut === null) controller.close();
        else controller.error(new TypeError("network error"));
      },
    });
    return new Response(stream, { status: range && !ignoreRanges ? 206 : 200 });
  };
  return {
    fetcher,
    asked,
    dropAfter: (count: number) => (dropAfter = count),
    ignoreRanges: () => (ignoreRanges = true),
  };
}

let folderId = 0;
/** A folder of its own for one test, removed when the test ends. */
const freshFolder = () => {
  folderId += 1;
  const id = `opfs-test-${folderId}`;
  const open = () => voiceFolder(id);
  return Object.assign(open, {
    [Symbol.asyncDispose]: async () => {
      const root = await navigator.storage.getDirectory();
      const voices = await root.getDirectoryHandle("majordome-voices", { create: true });
      await voices.removeEntry(id, { recursive: true }).catch(() => {});
    },
  });
};
const text = async (folder: () => Promise<FileSystemDirectoryHandle>, name: string) =>
  (await (await (await folder()).getFileHandle(name)).getFile()).text();

describe("voice files in the browser's private storage", () => {
  it("says a file that is not there has no size", async () => {
    await using folder = freshFolder();
    const files = createOpfsVoiceFiles(folder, host().fetcher);
    expect(await files.size("voice.bin")).toBeNull();
    expect(await files.sha256("voice.bin")).toBe("");
    await files.remove("voice.bin");
  });

  it("streams a download into a file and hashes what is on disk", async () => {
    await using folder = freshFolder();
    const files = createOpfsVoiceFiles(folder, host().fetcher);
    let received = 0;
    const { status } = await files.fetchInto({
      url: "https://voices.test/voice.bin",
      name: "voice.bin.part",
      offset: 0,
      signal: new AbortController().signal,
      onBytes: (count) => (received += count),
    });
    expect(status).toBe(200);
    expect(received).toBe(BODY.byteLength);
    expect(await files.size("voice.bin.part")).toBe(BODY.byteLength);
    expect(await files.sha256("voice.bin.part")).toBe(await hex(BODY));
  });

  it("keeps what arrived when the connection drops, and resumes from there", async () => {
    await using folder = freshFolder();
    const server = host();
    const files = createOpfsVoiceFiles(folder, server.fetcher);
    const request = {
      url: "https://voices.test/voice.bin",
      name: "voice.bin.part",
      signal: new AbortController().signal,
      onBytes: () => {},
    };
    server.dropAfter(7);
    await expect(files.fetchInto({ ...request, offset: 0 })).rejects.toThrow();
    expect(await files.size("voice.bin.part")).toBe(7);

    expect((await files.fetchInto({ ...request, offset: 7 })).status).toBe(206);
    expect(server.asked).toEqual([null, "bytes=7-"]);
    expect(await text(folder, "voice.bin.part")).toBe("0123456789abcdefghij");
  });

  it("starts the file over when the host ignores the range", async () => {
    await using folder = freshFolder();
    const server = host();
    const files = createOpfsVoiceFiles(folder, server.fetcher);
    const request = {
      url: "https://voices.test/voice.bin",
      name: "voice.bin.part",
      signal: new AbortController().signal,
      onBytes: () => {},
    };
    server.dropAfter(7);
    await expect(files.fetchInto({ ...request, offset: 0 })).rejects.toThrow();
    server.ignoreRanges();
    expect((await files.fetchInto({ ...request, offset: 7 })).status).toBe(200);
    expect(await text(folder, "voice.bin.part")).toBe("0123456789abcdefghij");
  });

  it("writes nothing for a refusal", async () => {
    await using folder = freshFolder();
    const files = createOpfsVoiceFiles(folder, async () => new Response("no", { status: 404 }));
    const { status } = await files.fetchInto({
      url: "https://voices.test/voice.bin",
      name: "voice.bin.part",
      offset: 0,
      signal: new AbortController().signal,
      onBytes: () => {},
    });
    expect(status).toBe(404);
    expect(await files.size("voice.bin.part")).toBeNull();
  });

  it("renames over a file already there, and removes", async () => {
    await using folder = freshFolder();
    const files = createOpfsVoiceFiles(folder, host().fetcher);
    const fetchAs = (name: string) =>
      files.fetchInto({
        url: "https://voices.test/voice.bin",
        name,
        offset: 0,
        signal: new AbortController().signal,
        onBytes: () => {},
      });
    await fetchAs("voice.bin");
    await fetchAs("voice.bin.part");
    await files.rename("voice.bin.part", "voice.bin");
    expect(await files.size("voice.bin.part")).toBeNull();
    expect(await files.size("voice.bin")).toBe(BODY.byteLength);
    await files.remove("voice.bin");
    expect(await files.size("voice.bin")).toBeNull();
  });

  it("carries a whole download through the shared store: resume, checksum, ready, gone", async () => {
    await using folder = freshFolder();
    const server = host();
    const catalog: VoiceCatalog = {
      id: "test",
      name: "Test",
      baseUrl: "https://voices.test",
      license: "openrail-m",
      copyright: "",
      languages: ["en"],
      files: [{ name: "voice.bin", size: BODY.byteLength, sha256: await hex(BODY) }],
    };
    const store = createVoiceStore(catalog, createOpfsVoiceFiles(folder, server.fetcher));
    expect((await store.refresh()).status).toBe("absent");
    server.dropAfter(5);
    expect((await store.download()).status).toBe("ready");
    expect(server.asked).toEqual([null, "bytes=5-"]);
    expect(await text(folder, "voice.bin")).toBe("0123456789abcdefghij");

    // Another session finds the files already there.
    const later = createVoiceStore(catalog, createOpfsVoiceFiles(folder, server.fetcher));
    expect((await later.refresh()).status).toBe("ready");
    await later.remove();
    expect((await later.refresh()).status).toBe("absent");

    // A damaged file is not kept.
    const damaged = createVoiceStore(
      { ...catalog, files: [{ ...catalog.files[0]!, sha256: BODY_SHA }] },
      createOpfsVoiceFiles(folder, server.fetcher),
    );
    expect(await damaged.download()).toEqual({ status: "failed", reason: "verification" });
    expect((await (await folder()).keys().next()).done).toBe(true);
  });
});
