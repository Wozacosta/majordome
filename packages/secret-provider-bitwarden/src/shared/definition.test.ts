import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  BitwardenSecretProviderConfig,
  definition,
  parseBitwardenReference,
} from "./definition.ts";

const ID = "2863ced6-eba1-48b4-b5c0-afa30104877a";
const isConfig = Schema.is(BitwardenSecretProviderConfig);

describe("Bitwarden Secrets Manager definition", () => {
  it("reads only a secret ID after bws://", () => {
    assert.strictEqual(parseBitwardenReference(`bws://${ID}`), ID);
    assert.isTrue(definition.isReference(`bws://${ID.toUpperCase()}`));
    for (const reference of [ID, "bws://garmin", `bws://${ID} --output env`, `op://${ID}`]) {
      assert.isFalse(definition.isReference(reference), reference);
    }
  });

  it("takes a key name and an https server, nothing that could be read as a flag", () => {
    assert.isTrue(isConfig({ tokenName: "bitwarden" }));
    assert.isTrue(isConfig({ tokenName: "bitwarden", serverUrl: "" }));
    assert.isTrue(isConfig({ tokenName: "bitwarden", serverUrl: "https://vault.bitwarden.eu" }));
    assert.isFalse(isConfig({ tokenName: "--access-token" }));
    assert.isFalse(isConfig({ tokenName: "bitwarden", serverUrl: "--config-file=/etc/passwd" }));
    assert.isFalse(isConfig({ tokenName: "bitwarden", serverUrl: "http://vault.example" }));
  });
});
