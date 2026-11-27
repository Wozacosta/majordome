/**
 * The voice files the Mac app and the web app download, passed through from GitHub's release
 * downloads, which send no CORS header. Read-only, and only these folders and names, so it is
 * not a proxy for anything else.
 */
const RELEASES = "https://github.com/Wozacosta/majordome/releases/download";

/** Release tag to the files of it that a window may ask for. */
export const VOICE_FILES: Readonly<Record<string, ReadonlyArray<string>>> = {
  "voice-supertonic-3-int8-1": [
    "duration_predictor.int8.onnx",
    "text_encoder.int8.onnx",
    "vector_estimator.int8.onnx",
    "vocoder.int8.onnx",
    "unicode_indexer.bin",
    "voice.bin",
    "tts.json",
  ],
  "voice-supertonic-3-web-1": ["vector_estimator.fp16.onnx", "vocoder.fp16.onnx"],
};

const VOICE_PATH = "/voice/";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "range",
  "access-control-expose-headers": "content-length, content-range, accept-ranges, etag",
  "access-control-max-age": "86400",
};

/** A release's files never change: a new set gets a new tag. */
const CACHE = "public, max-age=31536000, immutable";

const refuse = (status: number, text: string, headers: Record<string, string> = {}) =>
  new Response(`${text}\n`, { status, headers: { ...CORS, ...headers } });

/** Answers `/voice/<release-tag>/<file>`; null for any other path. */
export async function handleVoice(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(VOICE_PATH)) return null;
  const [tag, file, ...rest] = pathname.slice(VOICE_PATH.length).split("/");
  if (rest.length > 0 || !tag || !file || !Object.hasOwn(VOICE_FILES, tag)) {
    return refuse(404, "No such voice file.");
  }
  if (!VOICE_FILES[tag]!.includes(file)) return refuse(404, "No such voice file.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return refuse(405, "Voice files can only be read.", { allow: "GET, HEAD, OPTIONS" });
  }

  const range = request.headers.get("range");
  const upstream = await fetcher(`${RELEASES}/${tag}/${file}`, {
    method: request.method,
    headers: range === null ? {} : { range },
    redirect: "follow",
  });
  if (upstream.status !== 200 && upstream.status !== 206) {
    await upstream.body?.cancel();
    // 416 is the caller's own range; anything else is GitHub's trouble, not a missing file.
    return upstream.status === 416
      ? refuse(416, "That range is past the end of the file.")
      : refuse(502, "The voice file could not be fetched.", { "cache-control": "no-store" });
  }
  const headers = new Headers({
    ...CORS,
    "cache-control": CACHE,
    "accept-ranges": "bytes",
    "content-type": "application/octet-stream",
  });
  for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
