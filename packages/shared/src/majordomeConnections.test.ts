import * as NodeFS from "node:fs";

import { assert, it } from "vite-plus/test";

import {
  CONNECTION_RETURN_PAGE,
  connectionCallback,
  isLocalMajordomeOrigin,
} from "./majordomeConnections.ts";

it("returns straight to a Majordome on https, and through the page to a local one", () => {
  assert.deepEqual(connectionCallback({ origin: "https://quiet-otter.majord.link", nonce: "n" }), {
    redirectUri: "https://quiet-otter.majord.link/oauth/connections/callback",
    state: "n",
  });
  const local = connectionCallback({ origin: "http://127.0.0.1:3774", nonce: "n" });
  assert.equal(local?.redirectUri, CONNECTION_RETURN_PAGE);
  assert.equal(atob(local!.state.split(".")[1]!), "http://127.0.0.1:3774");
  assert.isNull(connectionCallback({ origin: "http://example.com", nonce: "n" }));
  assert.isNull(connectionCallback({ origin: "majordome://app", nonce: "n" }));
});

it("takes only addresses on the person's own computer or network as local", () => {
  for (const origin of [
    "http://localhost:3774",
    "http://192.168.1.20:3774",
    "http://10.0.0.5",
    "http://172.20.1.1:80",
    "http://100.101.102.103:3774",
    "http://mac-mini.local:3774",
    "http://mac.tail1234.ts.net:3774",
  ]) {
    assert.isTrue(isLocalMajordomeOrigin(origin), origin);
  }
  for (const origin of [
    "http://8.8.8.8",
    "http://172.32.0.1",
    "http://100.128.0.1",
    "http://evil.example",
    "http://127.0.0.1.evil.example",
    "http://127.0.0.1:3774/path",
    "http://user@127.0.0.1",
    "https://127.0.0.1",
  ]) {
    assert.isFalse(isLocalMajordomeOrigin(origin), origin);
  }
});

it("the return page checks addresses with the same rule", () => {
  const page = NodeFS.readFileSync(
    new URL("../../../site/connect/back/index.html", import.meta.url),
    "utf8",
  );
  const rule = /var local =\s*\/(.+)\/;/.exec(page)?.[1];
  const source = /const LOCAL_ORIGIN =\s*\/(.+)\/;/.exec(
    NodeFS.readFileSync(new URL("./majordomeConnections.ts", import.meta.url), "utf8"),
  )?.[1];
  assert.isString(rule);
  assert.equal(rule, source);
});
