import { describe, expect, it } from "@effect/vitest";

import { definition, parseKeychainReference } from "./definition.ts";

describe("Keychain definition", () => {
  it("reads the item's name and account out of a reference", () => {
    for (const [reference, service, account] of [
      ["keychain://Majordome/openai", "Majordome", "openai"],
      ["keychain://Majordome OpenAI/me@example.com", "Majordome OpenAI", "me@example.com"],
      ["keychain://api.example.com%2Fv1/100%25", "api.example.com/v1", "100%"],
      ["keychain://-s/-w", "-s", "-w"],
      ["keychain://caf%C3%A9/key", "café", "key"],
    ] as const) {
      expect(parseKeychainReference(reference), reference).toEqual({ service, account });
      expect(definition.isReference(reference), reference).toBe(true);
    }
  });

  it("rejects anything that is not exactly a name and an account", () => {
    for (const reference of [
      "Majordome/openai",
      "keychain://Majordome",
      "keychain://Majordome/",
      "keychain:///openai",
      "keychain://Majordome/openai/extra",
      "keychain://Majordome/ openai",
      "keychain://Majordome /openai",
      "keychain://Majordome/open\nai",
      "keychain://Majordome/open%0Aai",
      "keychain://Majordome/open%00ai",
      "keychain://Majordome/open%ZZai",
      "keychain://Majordome/%FF",
      "keychain://Majordome/$(id)",
      "keychain://Majordome/a;b",
      "keychain://Majordome/a'b",
      "KEYCHAIN://Majordome/openai",
      `keychain://Majordome/${"x".repeat(512)}`,
    ]) {
      expect(definition.isReference(reference), reference).toBe(false);
    }
  });
});
