import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { deriveRoutinesStatus } from "./routinesStatus.ts";

const provider = (overrides: Partial<ServerProvider> = {}) =>
  ({
    instanceId: ProviderInstanceId.make("claude"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [],
    ...overrides,
  }) as ServerProvider;

const signedOut = provider({ status: "error", auth: { status: "unauthenticated" } });
const codex = provider({ instanceId: ProviderInstanceId.make("codex"), displayName: "Codex" });
const claude = ProviderInstanceId.make("claude");

describe("deriveRoutinesStatus", () => {
  it.each([
    ["no provider at all", [], { ready: false, reason: "no-provider" }],
    [
      "a provider not checked yet",
      [provider({ installed: false, status: "warning", auth: { status: "unknown" } })],
      { ready: false, reason: "no-provider" },
    ],
    [
      "a signed-out provider",
      [signedOut],
      { ready: false, reason: "provider-signed-out", provider: "Claude" },
    ],
    ["a ready provider", [signedOut, codex], { ready: false, reason: "not-created" }],
  ] as const)("before the routines are made, with %s", (_name, providers, expected) => {
    expect(deriveRoutinesStatus({ created: false, routineProviders: [], providers })).toEqual(
      expected,
    );
  });

  it.each([
    ["ready", [provider()], { ready: true }],
    // The probe could not confirm the sign-in; runs still start.
    ["in warning", [provider({ status: "warning", auth: { status: "unknown" } })], { ready: true }],
    [
      "signed out, another one ready",
      [signedOut, codex],
      { ready: false, reason: "provider-signed-out", provider: "Claude" },
    ],
    [
      "turned off",
      [provider({ enabled: false, status: "disabled" })],
      { ready: false, reason: "provider-unavailable", provider: "Claude" },
    ],
    [
      "failing",
      [provider({ status: "error" })],
      { ready: false, reason: "provider-unavailable", provider: "Claude" },
    ],
    ["removed", [codex], { ready: false, reason: "provider-unavailable" }],
  ] as const)("once made, with their provider %s", (_name, providers, expected) => {
    expect(
      deriveRoutinesStatus({ created: true, routineProviders: [claude, claude], providers }),
    ).toEqual(expected);
  });

  it("has nothing to warn about once the owner deleted every routine", () => {
    expect(deriveRoutinesStatus({ created: true, routineProviders: [], providers: [] })).toEqual({
      ready: true,
    });
  });
});
