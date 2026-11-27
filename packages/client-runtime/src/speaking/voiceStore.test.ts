import { describe, expect, it } from "vite-plus/test";

import type { VoiceCatalog } from "./voiceCatalog.ts";
import { createVoiceStore, type VoiceFiles } from "./voiceStore.ts";

const CONTENT: Record<string, string> = { "a.onnx": "0123456789", "b.bin": "abcdef" };
// The fake digest is the content itself, so a wrong byte is a wrong checksum.
const catalog: VoiceCatalog = {
  id: "test-1",
  name: "Test",
  baseUrl: "https://voices.test/v1",
  license: "openrail-m",
  copyright: "",
  languages: ["en"],
  files: Object.entries(CONTENT).map(([name, text]) => ({
    name,
    size: text.length,
    sha256: text,
  })),
};

function fakeFiles(served: Record<string, string> = CONTENT) {
  const disk = new Map<string, string>();
  const requests: Array<{ url: string; offset: number }> = [];
  let failures = 0;
  const files: VoiceFiles = {
    size: async (name) => disk.get(name)?.length ?? null,
    sha256: async (name) => disk.get(name) ?? "",
    fetchInto: async ({ url, name, offset, signal, onBytes }) => {
      requests.push({ url, offset });
      const body = served[url.slice(catalog.baseUrl.length + 1)];
      if (body === undefined) return { status: 404 };
      const rest = body.slice(offset);
      if (failures > 0) {
        failures -= 1;
        // The connection drops after two bytes.
        disk.set(name, (offset > 0 ? (disk.get(name) ?? "") : "") + rest.slice(0, 2));
        onBytes(2);
        throw new Error("connection lost");
      }
      if (signal.aborted) throw new Error("aborted");
      disk.set(name, (offset > 0 ? (disk.get(name) ?? "") : "") + rest);
      onBytes(rest.length);
      return { status: offset > 0 ? 206 : 200 };
    },
    rename: async (from, to) => {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
    remove: async (name) => void disk.delete(name),
  };
  return { files, disk, requests, failNext: (count: number) => (failures = count) };
}

describe("voice store", () => {
  it("downloads every file and reports ready", async () => {
    const fake = fakeFiles();
    const store = createVoiceStore(catalog, fake.files);
    expect((await store.refresh()).status).toBe("absent");
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getState().status));

    expect(await store.download()).toEqual({ status: "ready" });

    expect(Object.fromEntries(fake.disk)).toEqual(CONTENT);
    expect(seen).toContain("downloading");
    expect((await createVoiceStore(catalog, fake.files).refresh()).status).toBe("ready");
  });

  it("resumes a partial file from where it stopped", async () => {
    const fake = fakeFiles();
    fake.disk.set("a.onnx.part", "0123");
    const store = createVoiceStore(catalog, fake.files);

    expect(await store.download()).toEqual({ status: "ready" });

    expect(fake.requests[0]).toEqual({ url: "https://voices.test/v1/a.onnx", offset: 4 });
    expect(fake.disk.get("a.onnx")).toBe("0123456789");
  });

  it("carries on after a dropped connection without starting over", async () => {
    const fake = fakeFiles();
    fake.failNext(1);
    const store = createVoiceStore(catalog, fake.files);

    expect(await store.download()).toEqual({ status: "ready" });

    expect(fake.requests.slice(0, 2).map((request) => request.offset)).toEqual([0, 2]);
  });

  it("is not ready when a checksum does not match, and drops the bad file", async () => {
    const fake = fakeFiles({ ...CONTENT, "b.bin": "abcdeX" });
    const store = createVoiceStore(catalog, fake.files);

    expect(await store.download()).toEqual({ status: "failed", reason: "verification" });

    expect(fake.disk.has("b.bin")).toBe(false);
    expect(fake.disk.has("b.bin.part")).toBe(false);
    expect((await store.refresh()).status).toBe("failed");
    expect((await createVoiceStore(catalog, fake.files).refresh()).status).toBe("absent");
  });

  it("fails as a network problem when the host refuses", async () => {
    const fake = fakeFiles({ "a.onnx": CONTENT["a.onnx"]! });
    const store = createVoiceStore(catalog, fake.files);
    expect(await store.download()).toEqual({ status: "failed", reason: "network" });
  });

  it("removes the files and partial files", async () => {
    const fake = fakeFiles();
    const store = createVoiceStore(catalog, fake.files);
    await store.download();
    fake.disk.set("a.onnx.part", "01");

    await store.remove();

    expect(fake.disk.size).toBe(0);
    expect(store.getState()).toEqual({ status: "absent" });
  });
});
