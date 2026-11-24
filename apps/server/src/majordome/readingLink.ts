// @effect-diagnostics nodeBuiltinImport:off - Effect has no DNS lookup or address block list.
/**
 * What a link saved to the reading list is: its title, where it is from, what kind of thing it is
 * and how long it takes. Looked up from the page itself, and never in the way of saving: a page
 * that cannot be read still gives a title made from its address.
 */

import * as NodeDnsPromises from "node:dns/promises";
import * as NodeNet from "node:net";

import type { MajordomeReadingKind } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

interface LinkDetails {
  readonly title: string;
  readonly site: string;
  readonly kind: MajordomeReadingKind;
  readonly minutes?: number;
  readonly image?: string;
  /** The page's opening text, for describing it; never saved. */
  readonly excerpt?: string;
  /** True when the site itself says there is no such page (404 or 410); never saved. */
  readonly missing?: true;
}

const EXCERPT_CHARS = 1_500;
const MAX_IMAGE_CHARS = 2_000;

/** A picture's address as the page gives it, made whole; only https, which any window can show. */
export function pictureAddress(raw: string | undefined, page: URL): string | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  try {
    const url = new URL(raw.trim(), page);
    return url.protocol === "https:" && url.href.length <= MAX_IMAGE_CHARS ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const LOOKUP_TIMEOUT = "8 seconds";
const MAX_BODY_BYTES = 1_000_000;
// A YouTube watch page is 1.5 to 2 MB and says how long the video is around 0.9 MB in, too near
// the usual cap to count on.
const YOUTUBE_MAX_BODY_BYTES = 2_500_000;
/** Shorter than the whole lookup, so a slow watch page costs the length and not the title. */
const YOUTUBE_LENGTH_TIMEOUT = "6 seconds";
const MAX_TITLE_CHARS = 300;
const WORDS_PER_MINUTE = 220;
/** Below this a page is a stub, a paywall or an app shell, and its length says nothing. */
const MIN_WORDS_FOR_MINUTES = 200;

const BARE_LINK = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?\/\S*$/i;

/**
 * The link `text` is, or null for a title. An address without `https://` counts when it starts
 * with `www.` or has a path, so a title like "Node.js" stays a title.
 */
export function parseLink(text: string): URL | null {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return null;
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^www\.[^./]+\.[^./]/i.test(trimmed) || BARE_LINK.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (candidate === null) return null;
  try {
    const url = new URL(candidate);
    return url.hostname.includes(".") || url.hostname === "localhost" ? url : null;
  } catch {
    return null;
  }
}

/** The same page gives the same text, whatever tracking or anchor the link carried. */
export function normalizeLink(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = "";
  for (const name of Array.from(copy.searchParams.keys())) {
    if (name.toLowerCase().startsWith("utm_")) copy.searchParams.delete(name);
  }
  const query = copy.searchParams.toString();
  const path = copy.pathname.replace(/\/+$/, "");
  return `${copy.protocol}//${copy.host.toLowerCase()}${path}${query === "" ? "" : `?${query}`}`;
}

// This machine, private networks, Tailscale's and carriers' shared range, and ranges never routed.
const REFUSED_ADDRESSES = new NodeNet.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  REFUSED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
// `::/96` holds `::`, `::1` and IPv4 written the old way; Teredo and 6to4 carry an IPv4 address.
for (const [network, prefix] of [
  ["::", 96],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  REFUSED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}
const NAT64_PREFIX = "64:ff9b::";
const NAT64 = new NodeNet.BlockList();
NAT64.addSubnet(NAT64_PREFIX, 96, "ipv6");

/** The IPv4 address a NAT64 address stands for, read from its last 32 bits. */
function nat64Target(address: string): string {
  const groups = new URL(`http://[${address}]/`).hostname
    .slice(NAT64_PREFIX.length + 1, -1)
    .split(":")
    .filter((group) => group !== "")
    .map((group) => Number.parseInt(group, 16));
  const low = groups.at(-1) ?? 0;
  const high = groups.length > 1 ? (groups[0] ?? 0) : 0;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * True for an address on this machine or a private network, and for text that is no address.
 * An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) is judged as the IPv4 address it is.
 */
function isRefusedAddress(text: string): boolean {
  const address = text.split("%", 1)[0] ?? "";
  const family = NodeNet.isIP(address);
  if (family === 0) return true;
  if (REFUSED_ADDRESSES.check(address, family === 6 ? "ipv6" : "ipv4")) return true;
  // Public sites are reached this way on IPv6-only networks, so only the target decides.
  return family === 6 && NAT64.check(address, "ipv6") && isRefusedAddress(nat64Target(address));
}

/**
 * True for a host on this machine or its private network, which a pasted link must never make
 * the server fetch. `hostname` is a `URL`'s, so odd spellings of an IP are already plain. A name
 * is judged again by the addresses it leads to, before anything is asked of it.
 */
export function isRefusedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  return NodeNet.isIP(literal) !== 0 && isRefusedAddress(literal);
}

/** The addresses a host name leads to, none when it has no answer. Tests answer for the network. */
export class HostAddresses extends Context.Reference<
  (host: string) => Effect.Effect<ReadonlyArray<string>>
>("t3/majordome/readingLink/HostAddresses", {
  defaultValue: () => (host) =>
    Effect.promise(() =>
      NodeDnsPromises.lookup(host, { all: true, verbatim: true }).then(
        (found): ReadonlyArray<string> => found.map((entry) => entry.address),
        (): ReadonlyArray<string> => [],
      ),
    ),
}) {}

const siteOfHost = (hostname: string) => hostname.toLowerCase().replace(/^www\./, "");

const isHostOrSubdomain = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

const isYouTube = (url: URL) =>
  isHostOrSubdomain(url.hostname.toLowerCase(), "youtube.com") ||
  siteOfHost(url.hostname) === "youtu.be";

export function kindOfLink(url: URL): MajordomeReadingKind {
  const host = siteOfHost(url.hostname);
  const path = url.pathname.toLowerCase();
  if (isYouTube(url) || isHostOrSubdomain(host, "vimeo.com")) return "video";
  if (host === "github.com" || host === "gitlab.com") return "repo";
  if (isHostOrSubdomain(host, "arxiv.org") || path.endsWith(".pdf")) return "paper";
  if (host === "podcasts.apple.com") return "podcast";
  if (host === "open.spotify.com" && path.startsWith("/episode")) return "podcast";
  if (host.startsWith("docs.") || host.includes("readthedocs")) return "doc";
  return "article";
}

/** What a link is saved as when its page could not be read: `example.com/blog/a-post`. */
export function fallbackLinkDetails(url: URL): LinkDetails {
  const site = siteOfHost(url.hostname);
  let path = url.pathname.replace(/\/+$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // A path that is not valid percent-encoding reads as it is written.
  }
  return { title: `${site}${path}`.slice(0, MAX_TITLE_CHARS), site, kind: kindOfLink(url) };
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: String.fromCodePoint(0x2014),
  hellip: "\u2026",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
};

const codePoint = (value: number, whole: string) =>
  Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;

function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return codePoint(Number.parseInt(body.slice(2), 16), whole);
    }
    if (body.startsWith("#")) return codePoint(Number.parseInt(body.slice(1), 10), whole);
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const tidy = (text: string) => decodeEntities(text).replaceAll(/\s+/g, " ").trim();

function metaContent(
  html: string,
  property: string,
  namedBy: ReadonlyArray<string> = ["property", "name"],
): string | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes.set((match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
    }
    const name = namedBy.map((attribute) => attributes.get(attribute)).find((value) => value);
    const content = tidy(attributes.get("content") ?? "");
    if (name?.toLowerCase() === property && content !== "") return content;
  }
  return undefined;
}

/** The seconds an ISO 8601 duration such as `PT1H56M12S` lasts; undefined when it is not one. */
export function isoDurationSeconds(text: string): number | undefined {
  const parts = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
    .exec(text.trim())
    ?.slice(1);
  if (parts === undefined || parts.every((part) => part === undefined)) return undefined;
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = parts.map((part) => Number(part ?? 0));
  return days * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/** A playing time in whole minutes, never less than one; undefined when there is none to tell. */
export function minutesOfSeconds(seconds: number | undefined): number | undefined {
  return seconds !== undefined && Number.isFinite(seconds) && seconds > 0
    ? Math.max(1, Math.round(seconds / 60))
    : undefined;
}

/**
 * How long a video or podcast plays, in minutes, as its page says it: the sharing tags
 * (`og:video:duration`, in seconds), schema.org's `duration`, or YouTube's own `lengthSeconds`.
 */
export function playingMinutes(html: string): number | undefined {
  const shared =
    metaContent(html, "og:video:duration") ??
    metaContent(html, "video:duration") ??
    metaContent(html, "music:duration");
  const marked = metaContent(html, "duration", ["itemprop"]);
  return (
    minutesOfSeconds(shared === undefined ? undefined : Number(shared)) ??
    minutesOfSeconds(marked === undefined ? undefined : isoDurationSeconds(marked)) ??
    minutesOfSeconds(Number(/"lengthSeconds"\s*:\s*"?(\d+)/.exec(html)?.[1] ?? Number.NaN))
  );
}

function visibleText(html: string): string {
  const body =
    /<article\b[\s\S]*<\/article>/i.exec(html)?.[0] ??
    /<main\b[\s\S]*<\/main>/i.exec(html)?.[0] ??
    /<body\b[\s\S]*/i.exec(html)?.[0] ??
    html;
  const text = tidy(
    body
      .replaceAll(/<!--[\s\S]*?-->/g, " ")
      .replaceAll(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replaceAll(/<[^>]+>/g, " "),
  );
  return text;
}

/**
 * The title, site, reading time, playing time and picture an HTML page gives; each left out when
 * the page has none. The picture needs `page` to make a relative address whole.
 */
export function extractPage(
  html: string,
  page?: URL,
): {
  readonly title?: string;
  readonly site?: string;
  readonly minutes?: number;
  /** For a video or podcast, in place of `minutes`, which counts the page's words. */
  readonly playMinutes?: number;
  readonly image?: string;
  readonly excerpt?: string;
} {
  const title =
    metaContent(html, "og:title") ??
    tidy(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const site = metaContent(html, "og:site_name");
  const text = visibleText(html);
  const words = text === "" ? 0 : text.split(" ").length;
  const excerpt = [metaContent(html, "og:description") ?? metaContent(html, "description"), text]
    .filter((part) => part !== undefined && part !== "")
    .join(" ")
    .slice(0, EXCERPT_CHARS);
  const image =
    page === undefined
      ? undefined
      : pictureAddress(metaContent(html, "og:image") ?? metaContent(html, "twitter:image"), page);
  const playMinutes = playingMinutes(html);
  return {
    ...(image === undefined ? {} : { image }),
    ...(excerpt === "" ? {} : { excerpt }),
    ...(title === "" ? {} : { title: title.slice(0, MAX_TITLE_CHARS).trim() }),
    ...(site === undefined ? {} : { site }),
    ...(words < MIN_WORDS_FOR_MINUTES
      ? {}
      : { minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)) }),
    ...(playMinutes === undefined ? {} : { playMinutes }),
  };
}

const YouTubeEmbed = Schema.Struct({
  title: Schema.String,
  author_name: Schema.optional(Schema.String),
  thumbnail_url: Schema.optional(Schema.String),
});

const HEADERS = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "Mozilla/5.0 (compatible; Majordome)",
};

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

class ReadingLinkRefusedError extends Schema.TaggedError<ReadingLinkRefusedError>()(
  "ReadingLinkRefusedError",
  { reason: Schema.Literals(["address", "redirects"]) },
) {}

/** Fails unless the address is a web page on a host that is, and leads to, a public address. */
const requirePublic = Effect.fn("majordome.readingLink.requirePublic")(function* (url: URL) {
  const refused = new ReadingLinkRefusedError({ reason: "address" });
  if (url.protocol !== "https:" && url.protocol !== "http:") return yield* refused;
  if (isRefusedHost(url.hostname)) return yield* refused;
  if (NodeNet.isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) return;
  const addresses = yield* (yield* HostAddresses)(url.hostname);
  if (addresses.length === 0 || addresses.some(isRefusedAddress)) return yield* refused;
});

/**
 * The page's answer, after following its redirects here instead of letting the client do it:
 * a public page may answer with the address of a private one, so each address is checked.
 */
const fetchPublic = Effect.fn("majordome.readingLink.fetchPublic")(function* (url: URL) {
  const http = yield* HttpClient.HttpClient;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    yield* requirePublic(current);
    const response = yield* http
      .execute(HttpClientRequest.get(current.href).pipe(HttpClientRequest.setHeaders(HEADERS)))
      .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));
    const location = response.headers["location"];
    if (!REDIRECT_STATUSES.has(response.status) || location === undefined) {
      return yield* HttpClientResponse.filterStatusOk(response);
    }
    if (!URL.canParse(location, current.href)) {
      return yield* new ReadingLinkRefusedError({ reason: "address" });
    }
    current = new URL(location, current);
  }
  return yield* new ReadingLinkRefusedError({ reason: "redirects" });
});

/** A page's HTML, up to `maxBytes` of it; undefined when it is not HTML. */
const readHtml = Effect.fn("majordome.readingLink.readHtml")(function* (
  url: URL,
  maxBytes: number,
) {
  const response = yield* fetchPublic(url);
  if (!(response.headers["content-type"] ?? "").toLowerCase().includes("html")) return undefined;
  let read = 0;
  const bytes = yield* response.stream.pipe(
    Stream.takeWhile((chunk) => {
      const wanted = read < maxBytes;
      read += chunk.length;
      return wanted;
    }),
    Stream.mkUint8Array,
  );
  return new TextDecoder().decode(bytes.subarray(0, maxBytes));
});

/** oEmbed names the video without a key; only the watch page says how long it is. */
const readYouTube = Effect.fn("majordome.readingLink.readYouTube")(function* (url: URL) {
  const http = yield* HttpClient.HttpClient;
  const named = http
    .execute(
      HttpClientRequest.get("https://www.youtube.com/oembed").pipe(
        HttpClientRequest.setUrlParams({ url: url.href, format: "json" }),
      ),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(YouTubeEmbed)),
    );
  const length = readHtml(url, YOUTUBE_MAX_BODY_BYTES).pipe(
    Effect.map((html) => (html === undefined ? undefined : playingMinutes(html))),
    Effect.timeoutOption(YOUTUBE_LENGTH_TIMEOUT),
    Effect.map(Option.getOrUndefined),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.undefined,
    ),
  );
  const [embed, minutes] = yield* Effect.all([named, length], { concurrency: 2 });
  const image = pictureAddress(embed.thumbnail_url, url);
  return {
    title: tidy(embed.title).slice(0, MAX_TITLE_CHARS).trim(),
    ...(embed.author_name === undefined ? {} : { site: embed.author_name }),
    ...(minutes === undefined ? {} : { minutes }),
    ...(image === undefined ? {} : { image }),
  };
});

const readPage = Effect.fn("majordome.readingLink.readPage")(function* (
  url: URL,
  kind: MajordomeReadingKind,
) {
  const html = yield* readHtml(url, MAX_BODY_BYTES);
  if (html === undefined) return {};
  const { playMinutes, ...found } = extractPage(html, url);
  // A video's page has few words of its own, so counting them says nothing about its length.
  return (kind === "video" || kind === "podcast") && playMinutes !== undefined
    ? { ...found, minutes: playMinutes }
    : found;
});

/**
 * Never fails: a page that is refused, slow, missing or not HTML gives the fallback. `kind` is
 * what the owner says the link is, when that is known better than its address tells.
 */
export const lookUpLink = Effect.fn("majordome.readingLink.lookUpLink")(function* (
  url: URL,
  kind?: MajordomeReadingKind,
) {
  const fallback = fallbackLinkDetails(url);
  if (isRefusedHost(url.hostname)) return fallback;
  const withFallback = (
    found: Omit<ReturnType<typeof extractPage>, "playMinutes">,
  ): LinkDetails => ({
    title: found.title === undefined || found.title === "" ? fallback.title : found.title,
    site: found.site === undefined || found.site === "" ? fallback.site : found.site,
    kind: fallback.kind,
    ...(found.minutes === undefined ? {} : { minutes: found.minutes }),
    ...(found.image === undefined ? {} : { image: found.image }),
    ...(found.excerpt === undefined ? {} : { excerpt: found.excerpt }),
  });
  const found = Effect.gen(function* () {
    return withFallback(
      isYouTube(url) ? yield* readYouTube(url) : yield* readPage(url, kind ?? fallback.kind),
    );
  });
  return yield* found.pipe(
    Effect.timeoutOption(LOOKUP_TIMEOUT),
    Effect.map(Option.getOrElse(() => fallback)),
    // A refusal (403) or a server error says nothing about the page; only these two say it is gone.
    Effect.catchIf(
      (error) =>
        HttpClientError.isHttpClientError(error) &&
        (error.response?.status === 404 || error.response?.status === 410),
      () => Effect.succeed<LinkDetails>({ ...fallback, missing: true }),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logDebug("Reading list link lookup failed", { cause }).pipe(Effect.as(fallback)),
    ),
  );
});
