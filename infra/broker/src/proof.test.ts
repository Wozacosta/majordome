import { describe, expect, it } from "vite-plus/test";

import { PROOF_AUDIENCE, verifyProof } from "./proof.ts";
import { makeIdentity, START } from "./testing.ts";

const NOW = Math.floor(START / 1000);
const claims = { aud: PROOF_AUDIENCE, act: "claim", port: 3774, iat: NOW, exp: NOW + 120 };

describe("verifyProof", () => {
  it("accepts a proof signed by the public key and derives a stable identity", async () => {
    const identity = await makeIdentity();
    const verify = async () =>
      verifyProof({
        publicKey: identity.publicKey,
        proof: await identity.sign(claims),
        action: "claim",
        nowSeconds: NOW,
      });

    const verified = await verify();
    expect(verified.port).toBe(3774);
    expect(verified.identity).toMatch(/^[0-9a-f]{64}$/u);
    expect((await verify()).identity).toBe(verified.identity);
  });

  it.each([
    ["wrong act", { claims: { ...claims, act: "release" } }],
    ["wrong aud", { claims: { ...claims, aud: "someone-else" } }],
    ["expired", { claims: { ...claims, iat: NOW - 200, exp: NOW - 1 } }],
    ["too-long lifetime", { claims: { ...claims, exp: NOW + 301 } }],
    ["issued too far ahead", { claims: { ...claims, iat: NOW + 301, exp: NOW + 400 } }],
    ["missing exp", { claims: { ...claims, exp: undefined } }],
    ["wrong typ", { claims, typ: "t3-env-link+jwt" }],
  ])("rejects a proof with %s", async (_name, input) => {
    const identity = await makeIdentity();
    await expect(
      verifyProof({
        publicKey: identity.publicKey,
        proof: await identity.sign(input.claims, "typ" in input ? input.typ : undefined),
        action: "claim",
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "invalid_proof" });
  });

  it("rejects a proof signed by another key, or altered after signing", async () => {
    const identity = await makeIdentity();
    const other = await makeIdentity();
    const proof = await identity.sign(claims);
    const [header, , signature] = proof.split(".");
    const forged = `${header}.${btoa(JSON.stringify({ ...claims, port: 22 })).replaceAll("=", "")}.${signature}`;

    for (const [publicKey, candidate] of [
      [other.publicKey, proof],
      [identity.publicKey, forged],
    ] as const) {
      await expect(
        verifyProof({ publicKey, proof: candidate, action: "claim", nowSeconds: NOW }),
      ).rejects.toMatchObject({ code: "invalid_proof" });
    }
  });

  it("rejects a public key that is not Ed25519 SPKI PEM", async () => {
    const identity = await makeIdentity();
    await expect(
      verifyProof({
        publicKey: "not a key",
        proof: await identity.sign(claims),
        action: "claim",
        nowSeconds: NOW,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
