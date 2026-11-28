import {
  type ManagedPolicySummary,
  type ProviderAuthState,
  ProjectId,
  resolveProviderInstanceEnabled,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  claudeSignsInByLink,
  cliTerminalStep,
  codexCardProvider,
  codexNeedsSetup,
  geminiCardProvider,
  geminiNeedsSetup,
  geminiSetupStep,
  geminiSignInStep,
  groupWelcomeAgents,
  isOwnComputer,
  majordomeAiName,
  majordomeWelcomeAgents,
  turnedOnInstance,
  welcomeOffersPhone,
  welcomeTurn,
} from "./welcomePage.logic";

function provider(name: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(name.toLowerCase()),
    driver: ProviderDriverKind.make(name.toLowerCase()),
    displayName: name,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-23T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const nameOf = (entry: ServerProvider) => entry.displayName ?? entry.driver;
const names = (entries: ReadonlyArray<ServerProvider>) => entries.map(nameOf);
const allowAll = () => true;

describe("groupWelcomeAgents", () => {
  it("lists agents on the computer by state, then name, and everything else by name", () => {
    const groups = groupWelcomeAgents(
      [
        provider("Zeta", { auth: { status: "unauthenticated" }, status: "error" }),
        provider("Codex"),
        provider("Pi", { enabled: false, status: "disabled" }),
        provider("Grok", { installed: false, status: "error", auth: { status: "unknown" } }),
        provider("Claude"),
        provider("Cursor", { installed: false, status: "warning", auth: { status: "unknown" } }),
      ],
      undefined,
      nameOf,
      allowAll,
    );

    expect(names(groups.found)).toEqual(["Claude", "Codex", "Zeta"]);
    // Cursor is still being checked; it stays listed instead of disappearing.
    expect(names(groups.available)).toEqual(["Cursor", "Grok", "Pi"]);
    expect(groups.checking).toBe(true);
    expect(groups.readyCount).toBe(2);
  });

  it("uses this computer's settings and keeps agents that failed to load with the found ones", () => {
    const acpRegistry = ProviderDriverKind.make("acpRegistry");
    const settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides"> = {
      providerInstances: {
        [ProviderInstanceId.make("pi")]: { driver: ProviderDriverKind.make("pi") },
        [ProviderInstanceId.make("registry")]: { driver: acpRegistry },
      },
      projectSettingsOverrides: {
        [ProjectId.make("project-a")]: {
          providerInstances: { [ProviderInstanceId.make("pi")]: { enabled: true } },
        },
      },
    };
    const groups = groupWelcomeAgents(
      [
        // The server checks Pi because project A turns it on; new projects still cannot use it.
        provider("Pi"),
        provider("Broken", {
          enabled: false,
          installed: false,
          status: "error",
          availability: "unavailable",
          unavailableReason: "Invalid config for instance 'broken'.",
        }),
        // Signed in and healthy, but the server knows this CLI version is broken.
        provider("Codex", {
          compatibilityAdvisory: {
            status: "broken",
            message: "Update Codex to 0.170 or later.",
            recommendedVersion: "0.170.0",
            recommendedRange: null,
          },
        }),
        // An ACP agent that is not prepared looks like one still being checked.
        provider("Registry", {
          driver: acpRegistry,
          installed: false,
          status: "warning",
          auth: { status: "unknown" },
        }),
      ],
      settings,
      nameOf,
      allowAll,
    );

    expect(names(groups.found)).toEqual(["Broken", "Codex", "Registry"]);
    expect(names(groups.available)).toEqual(["Pi"]);
    expect(groups.readyCount).toBe(0);
    expect(groups.checking).toBe(false);
  });

  it("leaves out agents the computer's policy does not allow, ready or not", () => {
    const groups = groupWelcomeAgents(
      [provider("Codex"), provider("Blocked")],
      undefined,
      nameOf,
      (entry) => entry.driver !== "blocked",
    );

    expect(names(groups.found)).toEqual(["Codex"]);
    expect(groups.readyCount).toBe(1);
  });

  it("reports checking before the computer has sent its providers", () => {
    expect(groupWelcomeAgents(undefined, undefined, nameOf, allowAll)).toEqual({
      checking: true,
      readyCount: 0,
      found: [],
      available: [],
    });
  });
});

describe("cliTerminalStep", () => {
  it("waits for the CLI's own check, then opens its terminal unless Codex is ready", () => {
    const codex = (overrides: Partial<ServerProvider> = {}) => provider("Codex", overrides);
    const step = (overrides?: Partial<ServerProvider>) =>
      cliTerminalStep(codex(overrides), undefined);

    // Still the ChatGPT sign-in runtime, before the switch to the CLI lands.
    expect(
      step({
        setup: { canAuthenticate: true, canInstall: true },
        auth: { status: "unauthenticated" },
      }),
    ).toBe("wait");
    expect(step({ installed: false, status: "warning", auth: { status: "unknown" } })).toBe("wait");
    expect(step({ installed: false, status: "error", auth: { status: "unknown" } })).toBe("open");
    expect(step({ auth: { status: "unauthenticated" } })).toBe("open");
    // A check that timed out still gets the sign-in command.
    expect(step({ status: "error", auth: { status: "unknown" } })).toBe("open");
    // A broken version is updated from its row in Settings, signed in, signed out, or unchecked.
    const broken = {
      status: "broken",
      message: "Update Codex.",
      recommendedVersion: null,
      recommendedRange: null,
    } as const;
    expect(step({ compatibilityAdvisory: broken })).toBe("done");
    expect(step({ compatibilityAdvisory: broken, auth: { status: "unauthenticated" } })).toBe(
      "done",
    );
    expect(
      step({ compatibilityAdvisory: broken, status: "error", auth: { status: "unknown" } }),
    ).toBe("done");
    // Signed in but needing a look for another reason: a sign-in would not help.
    expect(step({ status: "warning" })).toBe("done");
    // Signed in from its home files with the binary gone: the installer.
    expect(step({ installed: false, status: "error" })).toBe("open");
    expect(step()).toBe("done");
  });
});

describe("turnedOnInstance", () => {
  it("turns an agent on even when older settings keep it off inside its config", () => {
    const pi = ProviderDriverKind.make("pi");
    expect(resolveProviderInstanceEnabled(turnedOnInstance({ driver: pi }))).toBe(true);
    const migrated = turnedOnInstance({ driver: pi, config: { enabled: false, binaryPath: "pi" } });
    expect(resolveProviderInstanceEnabled(migrated)).toBe(true);
    expect(migrated.config).toEqual({ enabled: true, binaryPath: "pi" });
  });
});

describe("codexNeedsSetup", () => {
  it("opens the setup card only while Codex is not signed in", () => {
    const setup = (overrides: Partial<ServerProvider>) =>
      codexNeedsSetup(provider("Codex", overrides), undefined);

    expect(setup({ installed: false, status: "error", auth: { status: "unknown" } })).toBe(true);
    expect(setup({ auth: { status: "unauthenticated" } })).toBe(true);
    // A check that timed out can still sign in with ChatGPT.
    expect(setup({ status: "error", auth: { status: "unknown" } })).toBe(true);
    // Signed in from its home files but the binary is gone: Install, not the card.
    expect(setup({ installed: false, status: "error" })).toBe(false);
    // A broken version gets Update on its row.
    expect(
      setup({
        auth: { status: "unauthenticated" },
        compatibilityAdvisory: {
          status: "broken",
          message: null,
          recommendedVersion: null,
          recommendedRange: null,
        },
      }),
    ).toBe(false);
    expect(setup({})).toBe(false);
    const claude = provider("Claude", { auth: { status: "unauthenticated" } });
    expect(codexNeedsSetup(claude, undefined)).toBe(false);
  });
});

describe("codexCardProvider", () => {
  it("keeps the card on Codex's last status while a rebuild drops it, and closes once signed in", () => {
    const signedOut = provider("Codex", { auth: { status: "unauthenticated" } });
    const card = (providers: ReadonlyArray<ServerProvider>, last: ServerProvider | null = null) =>
      codexCardProvider({ providers, instanceId: signedOut.instanceId, last, settings: undefined });

    expect(card([signedOut])).toBe(signedOut);
    // The instance is missing for one update while it is rebuilt.
    expect(card([], signedOut)).toBe(signedOut);
    expect(card([], provider("Other"))).toBeNull();
    expect(card([provider("Codex")])).toBeNull();
    expect(
      codexCardProvider({
        providers: [signedOut],
        instanceId: null,
        last: null,
        settings: undefined,
      }),
    ).toBeNull();
  });
});

const ai = (driver: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  ...provider(driver),
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  displayName: undefined,
  ...overrides,
});
const notSetUp = { installed: false, status: "error", auth: { status: "unknown" } } as const;
const turnedOff = { ...notSetUp, enabled: false, status: "disabled" } as const;

describe("majordomeAiName", () => {
  it("names an AI by the owner's plan, and keeps a name the owner gave", () => {
    expect(majordomeAiName(ai("codex"), "Codex")).toBe("ChatGPT");
    expect(majordomeAiName(ai("antigravity"), "Antigravity")).toBe("Gemini");
    expect(majordomeAiName(ai("claudeAgent"), "Claude")).toBe("Claude");
    expect(majordomeAiName(ai("codex"), "Work")).toBe("Work");
    expect(majordomeAiName(ai("cursor"), "Cursor")).toBe("Cursor");
  });
});

describe("majordomeWelcomeAgents", () => {
  const claude = ai("claudeAgent", notSetUp);
  const chatGpt = ai("codex", { auth: { status: "unauthenticated" } });
  const gemini = ai("antigravity", turnedOff);
  const cursorReady = ai("cursor");
  const pi = ai("pi", notSetUp);
  const groups = { found: [cursorReady, chatGpt], available: [gemini, claude, pi] };
  const drivers = (providers: ReadonlyArray<ServerProvider>) =>
    providers.map((entry) => entry.driver);

  it("offers Claude, ChatGPT and Gemini first and in that order, set up or not", () => {
    const { listed, more } = majordomeWelcomeAgents(groups, { hosted: false });
    expect(drivers(listed)).toEqual(["claudeAgent", "codex", "antigravity", "cursor"]);
    expect(drivers(more)).toEqual(["pi"]);
  });

  it("offers only those three on a server Majordome hosts", () => {
    const { listed, more } = majordomeWelcomeAgents(groups, { hosted: true });
    expect(drivers(listed)).toEqual(["claudeAgent", "codex", "antigravity"]);
    expect(more).toEqual([]);
  });

  it("shows the accounts an AI already has, and keeps its unused ones with the rest", () => {
    const work = ai("codex", { instanceId: ProviderInstanceId.make("codex-work") });
    const spare = ai("codex", { ...notSetUp, instanceId: ProviderInstanceId.make("codex-spare") });
    const { listed, more } = majordomeWelcomeAgents(
      { found: [chatGpt, work], available: [spare] },
      { hosted: false },
    );
    expect(listed).toEqual([chatGpt, work]);
    expect(more).toEqual([spare]);
  });
});

describe("geminiNeedsSetup", () => {
  it("opens the setup card from turned off until Gemini is signed in", () => {
    const setup = (overrides: Partial<ServerProvider>) =>
      geminiNeedsSetup(ai("antigravity", overrides), undefined);

    expect(setup(turnedOff)).toBe(true);
    expect(setup(notSetUp)).toBe(true);
    // Installed, and Google has not been asked about the account yet.
    expect(setup({ status: "warning", auth: { status: "unknown" } })).toBe(true);
    expect(setup({ status: "warning", auth: { status: "unauthenticated" } })).toBe(true);
    expect(setup({})).toBe(false);
    expect(geminiNeedsSetup(ai("codex", notSetUp), undefined)).toBe(false);
  });
});

describe("geminiSetupStep", () => {
  const idle = { phase: "idle", installedVersion: null } as const;
  const step = (
    overrides: Partial<ServerProvider>,
    install: Parameters<typeof geminiSetupStep>[0]["install"] = idle,
  ) => geminiSetupStep({ provider: ai("antigravity", overrides), settings: undefined, install });

  it("goes from the download to the sign-in to done", () => {
    expect(step(turnedOff)).toBe("checking");
    expect(step(notSetUp, null)).toBe("checking");
    expect(step(notSetUp)).toBe("install");
    expect(step(notSetUp, { phase: "downloading", installedVersion: null })).toBe("installing");
    expect(step(notSetUp, { phase: "failed", installedVersion: null })).toBe("installFailed");
    // The download is done before the account's own check has noticed it.
    expect(step(notSetUp, { phase: "succeeded", installedVersion: "1.5.19" })).toBe("signIn");
    expect(step({ status: "warning", auth: { status: "unknown" } })).toBe("signIn");
    expect(step({})).toBe("done");
  });

  it("keeps showing a new download over an older one that is still installed", () => {
    expect(
      step(
        { status: "warning", auth: { status: "unknown" } },
        { phase: "extracting", installedVersion: "1.5.12" },
      ),
    ).toBe("installing");
  });
});

describe("geminiSignInStep", () => {
  const signedOut = ai("antigravity", { status: "warning", auth: { status: "unknown" } });
  const auth = (overrides: Partial<ProviderAuthState>): ProviderAuthState => ({
    instanceId: signedOut.instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
    ...overrides,
  });
  const step = (state: ProviderAuthState | null, provider = signedOut) =>
    geminiSignInStep({ provider, auth: state });
  const waiting = auth({
    phase: "waiting",
    flowId: "flow-1",
    authorizationUrl: "https://accounts.google.com/o/oauth2/auth?client_id=x",
    interaction: {
      type: "credentials",
      id: "flow-1",
      fields: [{ name: "code", label: "Code from the Antigravity page", secret: false }],
    },
  });

  it("asks for the code Google shows once the link is ready", () => {
    expect(step(null)).toEqual({ kind: "checking" });
    expect(step(auth({}))).toEqual({ kind: "start", problem: null });
    expect(step(auth({ phase: "starting" }))).toEqual({ kind: "starting" });
    expect(step(waiting)).toEqual({
      kind: "code",
      url: "https://accounts.google.com/o/oauth2/auth?client_id=x",
      flowId: "flow-1",
      interactionId: "flow-1",
      field: "code",
    });
    expect(step(auth({ phase: "verifying" }))).toEqual({ kind: "verifying" });
    expect(step(auth({ phase: "failed", message: "That code has expired." }))).toEqual({
      kind: "start",
      problem: "That code has expired.",
    });
  });

  it("leaves any other way of signing in to the form Settings draws", () => {
    expect(step(auth({ ...waiting, authorizationUrl: null }))).toEqual({ kind: "other" });
    expect(
      step(
        auth({
          phase: "waiting",
          flowId: "flow-1",
          interaction: {
            type: "browser",
            id: "flow-1",
            url: "https://accounts.google.com/o/oauth2/auth",
            requiresConsent: false,
          },
        }),
      ),
    ).toEqual({ kind: "other" });
    const keyed = ai("antigravity", { auth: { status: "unknown", type: "gemini-api-key" } });
    expect(step(auth({}), keyed)).toEqual({ kind: "other" });
  });
});

describe("geminiCardProvider", () => {
  it("stays open through a rebuild and closes once Gemini is signed in", () => {
    const signedOut = ai("antigravity", { status: "warning", auth: { status: "unknown" } });
    const card = (providers: ReadonlyArray<ServerProvider>, last: ServerProvider | null = null) =>
      geminiCardProvider({
        providers,
        instanceId: signedOut.instanceId,
        last,
        settings: undefined,
      });

    expect(card([signedOut])).toBe(signedOut);
    expect(card([], signedOut)).toBe(signedOut);
    expect(card([ai("antigravity")])).toBeNull();
  });
});

describe("isOwnComputer", () => {
  it("is the desktop app's own server, or a page served from this machine", () => {
    const own = (input: Partial<Parameters<typeof isOwnComputer>[0]>) =>
      isOwnComputer({ desktop: false, isPrimary: true, pageHost: "majordome.example", ...input });

    expect(own({ desktop: true })).toBe(true);
    expect(own({ pageHost: "localhost" })).toBe(true);
    expect(own({})).toBe(false);
    expect(own({ desktop: true, isPrimary: false })).toBe(false);
  });
});

describe("claudeSignsInByLink", () => {
  it("uses the link and code wherever the CLI's own browser would open out of the owner's sight", () => {
    const claude = provider("Claude", { driver: ProviderDriverKind.make("claudeAgent") });
    const byLink = (input: Partial<Parameters<typeof claudeSignsInByLink>[0]>) =>
      claudeSignsInByLink({
        majordome: true,
        desktop: false,
        isPrimary: true,
        pageHost: "notes.example.com",
        provider: claude,
        ...input,
      });

    // A server reached from a browser, such as a hosted one.
    expect(byLink({})).toBe(true);
    // Another computer added to the desktop app.
    expect(byLink({ desktop: true, isPrimary: false })).toBe(true);
    // The owner's own computer, where the CLI opens their browser: the desktop app, or its page.
    expect(byLink({ desktop: true })).toBe(false);
    expect(byLink({ pageHost: "127.0.0.1" })).toBe(false);
    expect(byLink({ pageHost: "localhost" })).toBe(false);
    // Not installed yet: the terminal installs it first.
    expect(byLink({ provider: { ...claude, installed: false } })).toBe(false);
    expect(byLink({ provider: provider("codex") })).toBe(false);
    expect(byLink({ majordome: false })).toBe(false);
  });
});

describe("welcomeOffersPhone", () => {
  it("offers the phone only through T3 Connect on the primary computer, and only when allowed", () => {
    const policy = (limits: ManagedPolicySummary["limits"]): ManagedPolicySummary => ({
      organization: "Acme",
      lockedSettings: [],
      ...(limits === undefined ? {} : { limits }),
    });
    const offers = (input: Partial<Parameters<typeof welcomeOffersPhone>[0]>) =>
      welcomeOffersPhone({
        isPrimary: true,
        cloud: true,
        canShare: true,
        policy: undefined,
        ...input,
      });

    expect(offers({})).toBe(true);
    // There is no pairing-code fallback; without T3 Connect the page leaves the phone out.
    expect(offers({ cloud: false })).toBe(false);
    expect(offers({ canShare: false })).toBe(false);
    expect(offers({ policy: policy({ connect: false }) })).toBe(false);
    expect(offers({ policy: policy({ clients: ["desktop"] }) })).toBe(false);
    expect(offers({ isPrimary: false })).toBe(false);
  });
});

describe("welcomeTurn", () => {
  const start = {
    named: false,
    assistantSettled: false,
    assistantSkipped: false,
    hasNotes: false,
  };

  it("asks the name, then the assistant, then the notes, then the first ask", () => {
    expect(welcomeTurn(start)).toBe("name");
    expect(welcomeTurn({ ...start, named: true })).toBe("assistant");
    expect(welcomeTurn({ ...start, named: true, assistantSettled: true })).toBe("notes");
    expect(welcomeTurn({ ...start, named: true, assistantSettled: true, hasNotes: true })).toBe(
      "firstAsk",
    );
  });

  it("moves on to the notes when the assistant is left for later", () => {
    expect(welcomeTurn({ ...start, named: true, assistantSkipped: true })).toBe("notes");
  });

  it("ends on the first ask once notes exist, such as ones restored before any answer", () => {
    expect(welcomeTurn({ ...start, hasNotes: true })).toBe("firstAsk");
  });
});
