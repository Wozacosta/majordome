import { assert, describe, it } from "@effect/vitest";

import {
  extractPage,
  fallbackLinkDetails,
  isRefusedHost,
  kindOfLink,
  normalizeLink,
  parseLink,
  pictureAddress,
} from "./readingLink.ts";

const hostOf = (address: string) => new URL(address).hostname;
const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

describe("readingLink", () => {
  it("tells a link from a title", () => {
    for (const [text, href] of [
      ["https://example.com/a", "https://example.com/a"],
      ["  HTTP://Example.com/a  ", "http://example.com/a"],
      ["www.example.com", "https://www.example.com/"],
      ["example.com/blog/post", "https://example.com/blog/post"],
    ] as const) {
      assert.equal(parseLink(text)?.href, href, text);
    }
    for (const title of ["Node.js", "The Pragmatic Programmer", "ftp://example.com/a", "a/b"]) {
      assert.isNull(parseLink(title), title);
    }
  });

  it("gives one text to the same page, whatever tracking or anchor the link carries", () => {
    const same = [
      "https://Example.com/post/",
      "https://example.com/post?utm_source=mail&utm_campaign=x",
      "https://example.com/post#comments",
    ].map((address) => normalizeLink(new URL(address)));
    assert.deepEqual(new Set(same), new Set(["https://example.com/post"]));
    assert.equal(
      normalizeLink(new URL("https://example.com/watch?v=1&utm_medium=x")),
      "https://example.com/watch?v=1",
    );
    assert.notEqual(
      normalizeLink(new URL("https://example.com/watch?v=1")),
      normalizeLink(new URL("https://example.com/watch?v=2")),
    );
  });

  it("refuses this machine and its private network, and nothing else", () => {
    for (const [address, refused] of [
      ["http://localhost:3000/", true],
      ["http://app.localhost/", true],
      ["http://printer.local/", true],
      ["http://10.1.2.3/", true],
      ["http://172.16.0.1/", true],
      ["http://172.31.255.255/", true],
      ["http://192.168.1.10/", true],
      ["http://127.0.0.1/", true],
      // A whole number is another way to write 127.0.0.1.
      ["http://2130706433/", true],
      ["http://169.254.169.254/", true],
      ["http://[::1]/", true],
      ["http://[::ffff:127.0.0.1]/", true],
      ["http://[fc00::1]/", true],
      ["http://[fd12:3456::1]/", true],
      ["http://[fe80::1]/", true],
      ["http://172.15.0.1/", false],
      ["http://172.32.0.1/", false],
      ["http://192.169.1.1/", false],
      ["http://8.8.8.8/", false],
      ["http://[2001:4860:4860::8888]/", false],
      ["https://example.com/", false],
      ["https://localhost.example.com/", false],
    ] as const) {
      assert.equal(isRefusedHost(hostOf(address)), refused, address);
    }
  });

  it("tells what kind of thing a link is from its address", () => {
    for (const [address, kind] of [
      ["https://www.youtube.com/watch?v=abc", "video"],
      ["https://m.youtube.com/watch?v=abc", "video"],
      ["https://youtu.be/abc", "video"],
      ["https://vimeo.com/123", "video"],
      ["https://github.com/effect-ts/effect", "repo"],
      ["https://gitlab.com/group/project", "repo"],
      ["https://arxiv.org/abs/1706.03762", "paper"],
      ["https://example.com/files/Report.PDF", "paper"],
      ["https://open.spotify.com/episode/abc", "podcast"],
      ["https://open.spotify.com/track/abc", "article"],
      ["https://podcasts.apple.com/us/podcast/x/id1", "podcast"],
      ["https://docs.python.org/3/", "doc"],
      ["https://effect.readthedocs.io/en/latest/", "doc"],
      ["https://example.com/blog/post", "article"],
    ] as const) {
      assert.equal(kindOfLink(new URL(address)), kind, address);
    }
  });

  it("names a page it could not read after its address", () => {
    assert.deepEqual(fallbackLinkDetails(new URL("https://www.example.com/blog/caf%C3%A9/?a=1")), {
      title: "example.com/blog/café",
      site: "example.com",
      kind: "article",
    });
    assert.equal(fallbackLinkDetails(new URL("https://example.com/")).title, "example.com");
  });

  it("reads a page's title and site, preferring what it says for sharing", () => {
    assert.deepEqual(
      extractPage(
        `<html><head><title>Ignored | Site</title>
         <meta content="Tom &amp; Jerry&#39;s &quot;day&quot; &#x2014; out" property="og:title">
         <meta property='og:site_name' content='The Daily'></head><body>Short.</body></html>`,
      ),
      { title: 'Tom & Jerry\'s "day" — out', site: "The Daily" },
    );
    assert.deepEqual(
      extractPage("<html><head><title>\n  A &lt;plain&gt;\n  title </title></head></html>"),
      { title: "A <plain> title" },
    );
    assert.deepEqual(extractPage("<html><body><p>No title here.</p></body></html>"), {});
  });

  it("finds a page's picture, whole and over https only", () => {
    const page = new URL("https://blog.example.com/posts/one");
    const picture = (meta: string) => extractPage(`<head>${meta}</head>`, page).image;
    assert.equal(
      picture('<meta property="og:image" content="/img/cover.jpg?w=1200&amp;h=630">'),
      "https://blog.example.com/img/cover.jpg?w=1200&h=630",
    );
    assert.equal(
      picture('<meta name="twitter:image" content="https://cdn.example.com/a.png">'),
      "https://cdn.example.com/a.png",
    );
    // A window served over https cannot show an http picture, and other schemes are not pictures.
    assert.isUndefined(
      picture('<meta property="og:image" content="http://blog.example.com/a.jpg">'),
    );
    assert.isUndefined(picture('<meta property="og:image" content="data:image/png;base64,AAAA">'));
    assert.equal(pictureAddress(`https://x.example/${"a".repeat(2100)}`, page), undefined);
    assert.isUndefined(extractPage('<meta property="og:image" content="/a.jpg">').image);
  });

  it("gives a reading time only to a page with enough words to tell", () => {
    const page = (count: number) =>
      `<html><head><title>T</title><style>p { color: red }</style></head><body>
       <script>var hidden = "${words(500)}";</script><p>${words(count)}</p></body></html>`;
    assert.isUndefined(extractPage(page(199)).minutes);
    assert.equal(extractPage(page(200)).minutes, 1);
    assert.equal(extractPage(page(2200)).minutes, 10);
    // Only the article counts when the page has one, not the menus around it.
    assert.equal(
      extractPage(`<body><nav>${words(3000)}</nav><article><p>${words(440)}</p></article></body>`)
        .minutes,
      2,
    );
  });
});
