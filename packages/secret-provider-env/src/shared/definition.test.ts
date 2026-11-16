import { describe, expect, it } from "@effect/vitest";

import { definition, parseEnvReference } from "./definition.ts";

describe("Environment variable definition", () => {
  it("reads the variable's name out of a reference", () => {
    for (const name of ["OPENAI_API_KEY", "_private", "key2", "a"]) {
      expect(parseEnvReference(`env://${name}`), name).toBe(name);
      expect(definition.isReference(`env://${name}`), name).toBe(true);
    }
  });

  it("rejects anything that is not one variable name", () => {
    for (const reference of [
      "OPENAI_API_KEY",
      "env://",
      "env://2FA",
      "env://OPENAI-API-KEY",
      "env://OPENAI API KEY",
      "env://A=B",
      "env://A/B",
      "env://$HOME",
      "env://A\nB",
      "ENV://A",
      `env://${"A".repeat(256)}`,
    ]) {
      expect(definition.isReference(reference), reference).toBe(false);
    }
  });
});
