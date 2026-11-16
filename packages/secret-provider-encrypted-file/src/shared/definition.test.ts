import { describe, expect, it } from "@effect/vitest";

import { definition, encryptedFileReference, parseEncryptedFileReference } from "./definition.ts";

describe("Encrypted file definition", () => {
  it("reads the secret's name out of a reference", () => {
    for (const name of ["openai", "OPENAI_API_KEY", "prod.api-key", "2fa"]) {
      expect(parseEncryptedFileReference(encryptedFileReference(name)), name).toBe(name);
      expect(definition.isReference(`secret://${name}`), name).toBe(true);
    }
  });

  it("rejects anything that is not one plain name", () => {
    for (const reference of [
      "openai",
      "secret://",
      "secret://-openai",
      "secret://.openai",
      "secret://work/openai",
      "secret://../openai",
      "secret://open ai",
      "secret://open\nai",
      "secret://__proto__",
      "SECRET://openai",
      `secret://${"a".repeat(129)}`,
    ]) {
      expect(definition.isReference(reference), reference).toBe(false);
    }
  });
});
