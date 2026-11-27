import { describe, expect, it } from "vite-plus/test";

import catalog from "../../../packages/client-runtime/src/speaking/voiceCatalog.json" with { type: "json" };
import { handleVoice, VOICE_FILES } from "./voice.ts";

const BODY = "0123456789";

function github() {
  const asked: Array<{ url: string; method: string; range: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const range = headers.get("range");
    asked.push({ url: String(input), method: init?.method ?? "GET", range });
    if (String(input).endsWith("/tts.json")) return new Response("gone", { status: 404 });
    const from = range === null ? null : Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
    if (from !== null && from >= BODY.length) return new Response(null, { status: 416 });
    const body = from === null ? BODY : BODY.slice(from);
    return new Response(body, {
      status: from === null ? 200 : 206,
      headers: {
        "content-length": String(body.length),
        ...(from === null
          ? {}
          : { "content-range": `bytes ${from}-${BODY.length - 1}/${BODY.length}` }),
        etag: '"abc"',
        "set-cookie": "tracking=1",
        "content-disposition": "attachment; filename=voice.bin",
      },
    });
  };
  return { asked, fetcher };
}

const ask = (path: string, init?: RequestInit) => new Request(`https://majord.link${path}`, init);

describe("voice files", () => {
  it("lists exactly the files the catalog names", () => {
    const tagOf = (baseUrl: string) => baseUrl.slice(baseUrl.lastIndexOf("/") + 1);
    expect(VOICE_FILES).toEqual({
      [tagOf(catalog.web.baseUrl)]: catalog.files.map((file) => file.name),
      [tagOf(catalog.web.fp16.baseUrl)]: catalog.web.fp16.files.map((file) => file.name),
    });
  });

  it("leaves every other path to the rest of the worker", async () => {
    const { asked, fetcher } = github();
    expect(await handleVoice(ask("/v1/address"), fetcher)).toBeNull();
    expect(await handleVoice(ask("/voices/x/y"), fetcher)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("passes a whole file through with CORS and a long cache", async () => {
    const { asked, fetcher } = github();
    const answer = await handleVoice(ask("/voice/voice-supertonic-3-int8-1/voice.bin"), fetcher);
    expect(answer?.status).toBe(200);
    expect(await answer?.text()).toBe(BODY);
    expect(asked).toEqual([
      {
        url: "https://github.com/Wozacosta/majordome/releases/download/voice-supertonic-3-int8-1/voice.bin",
        method: "GET",
        range: null,
      },
    ]);
    expect(Object.fromEntries(answer!.headers)).toMatchObject({
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "content-length, content-range, accept-ranges, etag",
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": "10",
      etag: '"abc"',
    });
    // Nothing of GitHub's own beyond what a download needs.
    expect(answer!.headers.get("set-cookie")).toBeNull();
    expect(answer!.headers.get("content-disposition")).toBeNull();
  });

  it("forwards a range, so a download resumes", async () => {
    const { asked, fetcher } = github();
    const answer = await handleVoice(
      ask("/voice/voice-supertonic-3-web-1/vocoder.fp16.onnx", { headers: { range: "bytes=4-" } }),
      fetcher,
    );
    expect(answer?.status).toBe(206);
    expect(await answer?.text()).toBe("456789");
    expect(answer?.headers.get("content-range")).toBe("bytes 4-9/10");
    expect(asked[0]?.range).toBe("bytes=4-");
  });

  it("answers a range past the end as GitHub does", async () => {
    const { fetcher } = github();
    const answer = await handleVoice(
      ask("/voice/voice-supertonic-3-int8-1/voice.bin", { headers: { range: "bytes=10-" } }),
      fetcher,
    );
    expect(answer?.status).toBe(416);
    expect(answer?.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers the preflight a range request causes", async () => {
    const { asked, fetcher } = github();
    const answer = await handleVoice(
      ask("/voice/voice-supertonic-3-int8-1/voice.bin", { method: "OPTIONS" }),
      fetcher,
    );
    expect(answer?.status).toBe(204);
    expect(answer?.headers.get("access-control-allow-headers")).toBe("range");
    expect(answer?.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(asked).toEqual([]);
  });

  it.each([
    "/voice/v0.9.0/Majordome.dmg",
    "/voice/voice-supertonic-3-int8-1/LICENSE",
    "/voice/voice-supertonic-3-int8-1/vocoder.fp16.onnx",
    "/voice/voice-supertonic-3-int8-1/voice.bin/extra",
    "/voice/voice-supertonic-3-int8-1/..%2F..%2Fv0.9.0%2FMajordome.dmg",
    "/voice/constructor/name",
    "/voice/voice-supertonic-3-int8-1/",
    "/voice/",
  ])("refuses %s without asking GitHub", async (path) => {
    const { asked, fetcher } = github();
    expect((await handleVoice(ask(path), fetcher))?.status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("only reads", async () => {
    const { asked, fetcher } = github();
    const answer = await handleVoice(
      ask("/voice/voice-supertonic-3-int8-1/voice.bin", { method: "POST", body: "x" }),
      fetcher,
    );
    expect(answer?.status).toBe(405);
    expect(asked).toEqual([]);
  });

  it("does not let a failure at GitHub be cached as the file", async () => {
    const { fetcher } = github();
    const answer = await handleVoice(ask("/voice/voice-supertonic-3-int8-1/tts.json"), fetcher);
    expect(answer?.status).toBe(502);
    expect(answer?.headers.get("cache-control")).toBe("no-store");
  });
});
