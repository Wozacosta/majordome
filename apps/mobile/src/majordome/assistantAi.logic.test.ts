import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  aiAccountKind,
  aiInstallStep,
  assistantAccountName,
  assistantAiName,
  assistantAis,
  assistantAiState,
  assistantStanding,
  computerAiStanding,
  listedAssistantAis,
  turnOnAiMutation,
} from "./assistantAi.logic";

function provider(driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-28T12:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const signedOut = { status: "warning", auth: { status: "unauthenticated" } } as const;
const phoneSetup = { canAuthenticate: true, canInstall: true };

// What a new Majordome server lists: Claude waiting for its sign-in, ChatGPT set up for the
// computer's own screen with nothing there, and Gemini turned off.
const claudeWaiting = provider("claudeAgent", signedOut);
const chatGptUntouched = provider("codex", { ...signedOut, installed: false, status: "error" });
const geminiOff = provider("antigravity", {
  enabled: false,
  installed: false,
  status: "disabled",
  auth: { status: "unknown" },
  setup: phoneSetup,
});
const fresh = [geminiOff, chatGptUntouched, claudeWaiting];

describe("assistantStanding", () => {
  it("offers the choice while no AI is signed in", () => {
    expect(assistantStanding(fresh)).toBe("choose");
    expect(listedAssistantAis(fresh).map((ai) => ai.name)).toEqual(["Claude", "ChatGPT", "Gemini"]);
  });

  it.each(["codex", "antigravity", "claudeAgent", "cursor"])(
    "is ready once %s alone is signed in",
    (driver) => {
      const providers = [...fresh.filter((entry) => entry.driver !== driver), provider(driver)];
      expect(assistantStanding(providers)).toBe("ready");
    },
  );

  it("lists only the AI that answers once one does", () => {
    const providers = [claudeWaiting, provider("codex"), geminiOff];
    expect(listedAssistantAis(providers).map((ai) => ai.name)).toEqual(["ChatGPT"]);
  });

  it("waits for the computer's checks before asking for anything", () => {
    expect(assistantStanding(null)).toBe("checking");
    expect(
      assistantStanding([
        provider("claudeAgent", {
          installed: false,
          status: "warning",
          auth: { status: "unknown" },
        }),
      ]),
    ).toBe("checking");
  });

  it("asks for no sign-in when an account is there and not working", () => {
    expect(assistantStanding([provider("claudeAgent", { status: "error" }), geminiOff])).toBe(
      "attention",
    );
    expect(assistantStanding([])).toBe("attention");
  });
});

describe("assistantAis", () => {
  it("takes the account that is ready over the first of its kind", () => {
    const second = provider("claudeAgent", { instanceId: ProviderInstanceId.make("claude-work") });
    expect(assistantAis([claudeWaiting, second])[0]?.provider).toBe(second);
  });

  it("reads a sign-in the phone can do and has not checked as a sign-in", () => {
    const gemini = provider("antigravity", {
      status: "warning",
      auth: { status: "unknown" },
      setup: phoneSetup,
    });
    expect(assistantAiState(gemini)).toBe("signIn");
    expect(assistantAiState(provider("claudeAgent", { status: "error" }))).toBe("attention");
  });

  it("names the AIs as Majordome does, and any other as its computer does", () => {
    expect(assistantAiName(chatGptUntouched)).toBe("ChatGPT");
    expect(assistantAiName(geminiOff)).toBe("Gemini");
    expect(assistantAiName(provider("cursor", { displayName: "Cursor" }))).toBe("Cursor");
    expect(assistantAccountName(provider("codex", { displayName: "Codex" }))).toBe("ChatGPT");
    expect(
      assistantAccountName(
        provider("codex", {
          instanceId: ProviderInstanceId.make("codex-work"),
          displayName: "Work",
        }),
      ),
    ).toBe("Work");
  });
});

describe("aiAccountKind", () => {
  it("turns on an AI that is off, and a ChatGPT that would sign in on the computer", () => {
    expect(aiAccountKind(geminiOff)).toBe("setUp");
    expect(aiAccountKind(chatGptUntouched)).toBe("setUp");
  });

  it("shows the account once the phone can install it or sign it in", () => {
    expect(aiAccountKind({ ...chatGptUntouched, setup: phoneSetup })).toBe("account");
    expect(aiAccountKind({ ...geminiOff, enabled: true, status: "error" })).toBe("account");
  });

  it("leaves a ChatGPT signed in on the computer as it is", () => {
    expect(aiAccountKind(provider("codex"))).toBe("signedInElsewhere");
  });
});

describe("turnOnAiMutation", () => {
  it("turns Gemini on and keeps what was saved for it", () => {
    const saved = {
      driver: geminiOff.driver,
      displayName: "Work",
      enabled: false,
      config: { enabled: false, authMethod: "gemini-api-key" },
    };
    expect(turnOnAiMutation(geminiOff, saved)).toEqual({
      operation: "upsert",
      instanceId: "antigravity",
      instance: {
        driver: "antigravity",
        displayName: "Work",
        enabled: true,
        config: { enabled: true, authMethod: "gemini-api-key" },
      },
    });
  });

  it("moves ChatGPT to the sign-in a phone can do", () => {
    expect(turnOnAiMutation(chatGptUntouched, undefined)).toEqual({
      operation: "upsert",
      instanceId: "codex",
      instance: {
        driver: "codex",
        enabled: true,
        config: { enabled: true, setupMode: "managed" },
      },
    });
  });
});

describe("aiInstallStep", () => {
  it("counts a download in whole megabytes", () => {
    expect(
      aiInstallStep({ phase: "downloading", downloadedBytes: 12_400_000, totalBytes: 80_000_000 }),
    ).toEqual({ kind: "downloading", downloaded: "12", total: "80" });
    expect(
      aiInstallStep({ phase: "downloading", downloadedBytes: 3_000_000, totalBytes: null }),
    ).toEqual({ kind: "downloading", downloaded: "3", total: null });
  });

  it("is installing until the download is unpacked and checked", () => {
    const sized = { downloadedBytes: 0, totalBytes: null };
    expect(aiInstallStep({ phase: "extracting", ...sized }).kind).toBe("installing");
    expect(aiInstallStep({ phase: "verifying", ...sized }).kind).toBe("installing");
    expect(aiInstallStep({ phase: "failed", ...sized }).kind).toBe("idle");
    expect(aiInstallStep(null).kind).toBe("idle");
  });
});

describe("computerAiStanding", () => {
  it("names the AI new chats run on", () => {
    const providers = [provider("claudeAgent"), provider("codex")];
    expect(computerAiStanding(providers, null)).toEqual({ state: "ready", name: "Claude" });
    expect(computerAiStanding(providers, "codex")).toEqual({ state: "ready", name: "ChatGPT" });
    expect(computerAiStanding([claudeWaiting, provider("antigravity")], "claudeAgent")).toEqual({
      state: "ready",
      name: "Gemini",
    });
  });

  it("asks for a sign-in while none is signed in", () => {
    expect(computerAiStanding(fresh, null)).toEqual({ state: "signIn" });
    expect(computerAiStanding(undefined, null)).toEqual({ state: "checking" });
    expect(computerAiStanding([provider("claudeAgent", { status: "error" })], null)).toEqual({
      state: "attention",
    });
  });
});
