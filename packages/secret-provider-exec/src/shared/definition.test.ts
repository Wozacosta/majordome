import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { definition, ExecSecretProviderConfig, parseExecReference } from "./definition.ts";

const isConfig = Schema.is(ExecSecretProviderConfig);

describe("Command definition", () => {
  it("reads the secret's name out of a reference", () => {
    for (const name of ["OPENAI_API_KEY", "work/openai", "prod.api-key", "_x", "a/b/c.d"]) {
      expect(parseExecReference(`exec://${name}`), name).toBe(name);
      expect(definition.isReference(`exec://${name}`), name).toBe(true);
    }
  });

  it("rejects names a program could read as an option, a path escape or a command", () => {
    for (const reference of [
      "OPENAI_API_KEY",
      "exec://",
      "exec://--help",
      "exec://-x",
      "exec://work/--help",
      "exec://../etc/passwd",
      "exec://work/../other",
      "exec://.hidden",
      "exec:///etc/passwd",
      "exec://work//openai",
      "exec://work/",
      "exec://a b",
      "exec://a;id",
      "exec://$(id)",
      "exec://a`id`",
      "exec://a|b",
      "exec://a&b",
      "exec://a\nb",
      "exec://a'b",
      'exec://a"b',
      "EXEC://a",
      `exec://${"a".repeat(257)}`,
    ]) {
      expect(definition.isReference(reference), reference).toBe(false);
    }
  });

  it("accepts a program with fixed arguments and rejects one that is an option or empty", () => {
    for (const config of [
      { command: "/usr/local/bin/infisical", args: ["secrets", "get", "--plain"] },
      { command: "pass", args: ["show"] },
      { command: "my tool" },
    ]) {
      expect(isConfig(config), JSON.stringify(config)).toBe(true);
    }
    for (const config of [
      {},
      { command: "" },
      { command: "--version" },
      { command: "sh\n-c" },
      { command: "pass", args: [""] },
      { command: "pass", args: ["a\nb"] },
      { command: "pass", args: "show" },
      { command: "pass", args: Array.from({ length: 33 }, () => "x") },
    ]) {
      expect(isConfig(config), JSON.stringify(config)).toBe(false);
    }
  });
});
