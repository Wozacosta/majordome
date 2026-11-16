import { SecretProviderId, SecretProviderKind } from "@t3tools/contracts";
import { builtInSecretProviderDefinitions } from "@t3tools/secret-provider-definitions/registry";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  classifySecretProvider,
  draftFromSecretProvider,
  secretProviderFromDraft,
} from "./SecretProviderDialog.logic";

const kind = SecretProviderKind.make;
const onePassword = kind("one_password");

describe("secretProviderFromDraft", () => {
  it("adds a provider keyed by its name and reports every field that blocks it", () => {
    expect(
      secretProviderFromDraft(
        { name: "  1Password!  ", kind: onePassword, fields: { account: "my.1password.com" } },
        new Set(),
        { mode: "add" },
      ),
    ).toEqual(
      Result.succeed({
        id: "1password",
        config: {
          kind: "one_password",
          label: "1Password!",
          config: { account: "my.1password.com" },
        },
      }),
    );

    const blocked = secretProviderFromDraft(
      { name: "1Password", kind: onePassword, fields: { account: "--help" } },
      new Set(["1password"]),
      { mode: "add" },
    );
    expect(Result.isFailure(blocked) && blocked.failure.name).toBeTypeOf("string");
    expect(Result.isFailure(blocked) && Object.keys(blocked.failure.fields)).toEqual(["account"]);
  });

  it("keeps the id when an edit renames the provider", () => {
    const id = SecretProviderId.make("personal");
    const result = secretProviderFromDraft(
      { name: "Personal (team)", kind: onePassword, fields: { account: "team.1password.com" } },
      new Set(["personal"]),
      { mode: "edit", id },
    );
    expect(Result.isSuccess(result) && result.success).toEqual({
      id,
      config: {
        kind: "one_password",
        label: "Personal (team)",
        config: { account: "team.1password.com" },
      },
    });
  });

  it("builds every kind's settings from what its fields hold", () => {
    const from = (draftKind: string, fields: Readonly<Record<string, string>>) => {
      const result = secretProviderFromDraft(
        { name: "Keys", kind: kind(draftKind), fields },
        new Set(),
        { mode: "add" },
      );
      return Result.isSuccess(result)
        ? result.success.config.config
        : { blocked: Object.keys(result.failure.fields) };
    };

    for (const noSettings of ["keychain", "encrypted_file", "env"]) {
      expect(from(noSettings, {}), noSettings).toEqual({});
    }
    expect(
      from("exec", { command: " /usr/local/bin/infisical ", args: "secrets\n  get\n\n--plain\n" }),
    ).toEqual({ command: "/usr/local/bin/infisical", args: ["secrets", "get", "--plain"] });
    expect(from("exec", { command: "pass", args: "" })).toEqual({ command: "pass" });
    expect(from("exec", { command: "", args: "show" })).toEqual({ blocked: ["command"] });
    expect(from("exec", { command: "--version" })).toEqual({ blocked: ["command"] });
    expect(
      Result.isFailure(
        secretProviderFromDraft(
          { name: "Keys", kind: kind("from_a_newer_build"), fields: {} },
          new Set(),
          { mode: "add" },
        ),
      ),
    ).toBe(true);
  });

  it("saves settings every kind's own server check accepts, and reads them back for editing", () => {
    const drafts: Readonly<Record<string, Readonly<Record<string, string>>>> = {
      one_password: { account: "my.1password.com" },
      exec: { command: "pass", args: "show\n--clip" },
    };
    for (const definition of builtInSecretProviderDefinitions.definitions) {
      const fields = drafts[definition.kind] ?? {};
      const result = secretProviderFromDraft(
        { name: "Keys", kind: definition.kind, fields },
        new Set(),
        {
          mode: "add",
        },
      );
      if (!Result.isSuccess(result)) throw new Error(`${definition.kind} draft was blocked`);
      expect(classifySecretProvider(result.success.config).kind, definition.kind).toBe("supported");
      expect(draftFromSecretProvider(result.success.config), definition.kind).toEqual({
        name: "Keys",
        kind: definition.kind,
        fields: Object.fromEntries(
          definition.configFields.map((field) => [field.key, fields[field.key] ?? ""]),
        ),
      });
    }
  });
});

describe("classifySecretProvider", () => {
  it("summarizes what the owner entered and hides an account until revealed", () => {
    const classify = (providerKind: string, config: unknown) => {
      const classified = classifySecretProvider({
        kind: kind(providerKind),
        label: "Keys",
        config,
      });
      return classified.kind === "supported" ? classified.summary : classified.kind;
    };
    expect(classify("one_password", { account: "my.1password.com" })).toEqual({
      text: "my.1password.com",
      sensitive: true,
    });
    expect(classify("exec", { command: "pass", args: ["show", "--clip"] })).toEqual({
      text: "pass show --clip",
      sensitive: false,
    });
    expect(classify("keychain", {})).toBeUndefined();
    expect(classify("one_password", {})).toBe("unsupported");
    expect(classify("from_a_newer_build", {})).toBe("unsupported");
  });
});
