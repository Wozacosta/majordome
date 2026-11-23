import { expect, it } from "vite-plus/test";

import { pairLinkAsAppLink } from "./pairLink";

const BASE = "majordome://";

it("turns a server's pairing address into the app's add-a-computer link, code kept", () => {
  const link = new URL(pairLinkAsAppLink("https://k7m2.majord.link/pair#token=AB12", BASE));
  expect(link.protocol + link.host + link.pathname).toBe("majordome:connections/new");
  expect(link.searchParams.get("pairingUrl")).toBe("https://k7m2.majord.link/pair#token=AB12");
});

it.each([
  "https://k7m2.majord.link/pair",
  "https://k7m2.majord.link/threads/a/b#token=AB12",
  "http://k7m2.majord.link/pair#token=AB12",
  "majordome://connections/new?pairingUrl=x",
  "not a link",
])("leaves %s as it came", (url) => {
  expect(pairLinkAsAppLink(url, BASE)).toBe(url);
});
