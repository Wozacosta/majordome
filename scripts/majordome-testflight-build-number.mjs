#!/usr/bin/env node
// Prints the build number to use for the next TestFlight upload: one past the newest uploaded.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

const [keyPath, keyId, issuer, appId] = process.argv.slice(2);
if (!keyPath || !keyId || !issuer || !appId) {
  console.error(
    "usage: majordome-testflight-build-number.mjs <key.p8> <key id> <issuer id> <app id>",
  );
  process.exit(2);
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({
  iss: issuer,
  iat: now,
  exp: now + 300,
  aud: "appstoreconnect-v1",
})}`;
const signature = NodeCrypto.createSign("SHA256")
  .update(unsigned)
  .sign({
    key: NodeCrypto.createPrivateKey(NodeFS.readFileSync(keyPath)),
    dsaEncoding: "ieee-p1363",
  })
  .toString("base64url");

const response = await fetch(
  `https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=20&fields[builds]=version`,
  { headers: { authorization: `Bearer ${unsigned}.${signature}` } },
);
if (!response.ok) {
  console.error(`App Store Connect answered ${response.status}.`);
  process.exit(1);
}
const { data } = await response.json();
const newest = Math.max(0, ...data.map((build) => Number(build.attributes.version) || 0));
console.log(String(newest + 1));
