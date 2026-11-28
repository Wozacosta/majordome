import { isLocalLoopbackHost } from "@t3tools/shared/hostClassification";
import { MAJORDOME_AIS, majordomeAiDriverName } from "@t3tools/shared/majordome";
import {
  isProviderAvailable,
  managedCapabilityDenial,
  type ManagedPolicySummary,
  PROVIDER_DISPLAY_NAMES,
  type ProviderAuthState,
  type ProviderInstallState,
  type ProviderInstanceConfig,
  ProviderDriverKind,
  type ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";

import { getOnboardingProviderState } from "./providerReadiness.logic";

type ComputerSettings = Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">;

// Ready agents first, then ones that need a sign-in or a look. Never ranked by vendor.
const FOUND_ORDER = { ready: 0, signIn: 1, attention: 2 } as const;
type FoundState = keyof typeof FOUND_ORDER;

const isFoundState = (state: string): state is FoundState => state in FOUND_ORDER;

const ACP_REGISTRY_DRIVER = ProviderDriverKind.make("acpRegistry");

/**
 * An agent's state for new threads on this computer. The server also lists agents that only some
 * projects turn on, lists an agent it could not load as off, which Turn on cannot fix, and can pass
 * a CLI whose version it knows is broken.
 */
export function welcomeAgentState(
  provider: ServerProvider,
  settings: ComputerSettings | null | undefined,
) {
  if (!isProviderAvailable(provider)) return "attention";
  if (settings && !resolveProjectProviderInstanceEnabled(settings, null, provider.instanceId)) {
    return "disabled";
  }
  const state = getOnboardingProviderState(provider);
  if (state === "ready" && provider.compatibilityAdvisory?.status === "broken") return "attention";
  // An ACP agent that is not prepared reports the same fields as one still being checked.
  return state === "checking" && provider.driver === ACP_REGISTRY_DRIVER ? "attention" : state;
}

/**
 * Splits a computer's allowed providers into agents already on it and agents the user can add.
 * Order inside each group is by state, then by the name the user sees. Agents still being
 * checked are listed with the ones to add, so a slow check never drops an agent.
 */
export function groupWelcomeAgents(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
  settings: ComputerSettings | null | undefined,
  nameOf: (provider: ServerProvider) => string,
  isAllowed: (provider: ServerProvider) => boolean,
) {
  const found: Array<{ readonly provider: ServerProvider; readonly state: FoundState }> = [];
  const available: ServerProvider[] = [];
  let checking = providers == null;
  let readyCount = 0;
  for (const provider of providers ?? []) {
    if (!isAllowed(provider)) continue;
    const state = welcomeAgentState(provider, settings);
    if (state === "ready") readyCount += 1;
    if (state === "checking") checking = true;
    if (isFoundState(state)) found.push({ provider, state });
    else available.push(provider);
  }
  const byName = (a: ServerProvider, b: ServerProvider) => nameOf(a).localeCompare(nameOf(b));
  found.sort(
    (a, b) => FOUND_ORDER[a.state] - FOUND_ORDER[b.state] || byName(a.provider, b.provider),
  );
  available.sort(byName);
  return { checking, readyCount, found: found.map((entry) => entry.provider), available };
}

// These sign in with a key or a cloud project, entered in a form of their own.
const GEMINI_KEYED_SIGN_INS: ReadonlySet<string> = new Set(["gemini-api-key", "agent-platform"]);

/**
 * Where a Google account's sign-in to Gemini stands: Google shows a code on its last page, which
 * the owner pastes back. `other` is any other way of signing in, which Settings draws.
 */
export function geminiSignInStep(input: {
  readonly provider: Pick<ServerProvider, "auth">;
  readonly auth: ProviderAuthState | null;
}) {
  const { auth } = input;
  if (GEMINI_KEYED_SIGN_INS.has(input.provider.auth.type ?? "")) return { kind: "other" } as const;
  if (auth === null) return { kind: "checking" } as const;
  if (auth.phase === "starting") return { kind: "starting" } as const;
  if (auth.phase === "verifying") return { kind: "verifying" } as const;
  if (auth.phase === "waiting") {
    const { interaction, authorizationUrl: url, flowId } = auth;
    const field = interaction?.type === "credentials" ? interaction.fields[0] : undefined;
    if (
      interaction?.type !== "credentials" ||
      interaction.fields.length !== 1 ||
      field === undefined ||
      url === null ||
      flowId === null
    ) {
      return { kind: "other" } as const;
    }
    return { kind: "code", url, flowId, interactionId: interaction.id, field: field.name } as const;
  }
  return { kind: "start", problem: auth.phase === "failed" ? auth.message : null } as const;
}

/** Older settings can also keep `enabled: false` inside `config`, which still turns the agent off. */
export function turnedOnInstance(instance: ProviderInstanceConfig): ProviderInstanceConfig {
  const { config } = instance;
  const configOff =
    typeof config === "object" &&
    config !== null &&
    "enabled" in config &&
    config.enabled === false;
  return {
    ...instance,
    enabled: true,
    ...(configOff ? { config: { ...config, enabled: true } } : {}),
  };
}

/** A CLI the server knows is too old or otherwise broken for T3 Code; Settings updates it. */
export function isBrokenVersion(provider: ServerProvider) {
  return provider.installed && provider.compatibilityAdvisory?.status === "broken";
}

/**
 * What "Use existing CLI" does next for Codex: wait for the CLI's own check, open its terminal,
 * or stop. Only the ChatGPT sign-in runtime reports `setup.canAuthenticate`.
 */
export function cliTerminalStep(
  provider: ServerProvider,
  settings: ComputerSettings | null | undefined,
) {
  if (provider.setup?.canAuthenticate === true) return "wait";
  const state = welcomeAgentState(provider, settings);
  if (state === "checking") return "wait";
  // A broken version is updated from its row, and an installed, signed-in CLI needs no terminal.
  if (isBrokenVersion(provider)) return "done";
  if (provider.installed && provider.auth.status === "authenticated") return "done";
  // The terminal shows the command first, so it also helps a CLI whose check failed.
  const fixable =
    state === "install" ||
    state === "signIn" ||
    (state === "attention" && isProviderAvailable(provider));
  return fixable ? "open" : "done";
}

/**
 * Whether Codex's row opens its setup card, which offers ChatGPT sign-in or the CLI. A signed-in
 * or broken Codex gets its plain row action instead, since the card has nothing left for it.
 */
export function codexNeedsSetup(
  provider: ServerProvider,
  settings: ComputerSettings | null | undefined,
) {
  if (
    provider.driver !== "codex" ||
    provider.auth.status === "authenticated" ||
    isBrokenVersion(provider)
  ) {
    return false;
  }
  const state = welcomeAgentState(provider, settings);
  return (
    state === "install" ||
    state === "signIn" ||
    (state === "attention" && isProviderAvailable(provider))
  );
}

/**
 * The phone joins by signing in to T3 Connect, which shares the primary computer. Another
 * computer, a build without T3 Connect, or a policy that turns it off gets no Phone section.
 */
export function welcomeOffersPhone(input: {
  readonly isPrimary: boolean;
  readonly cloud: boolean;
  // Relay read and write access, which sharing this computer through T3 Connect needs.
  readonly canShare: boolean;
  readonly policy: ManagedPolicySummary | undefined;
}) {
  return (
    input.isPrimary &&
    input.cloud &&
    input.canShare &&
    managedCapabilityDenial(input.policy, "remoteClients") === undefined &&
    managedCapabilityDenial(input.policy, "connect") === undefined
  );
}

/**
 * Whether a browser the computer opens reaches the owner: only on their own computer, which is
 * the desktop app's own server or a page served from a loopback address.
 */
export function isOwnComputer(input: {
  readonly desktop: boolean;
  readonly isPrimary: boolean;
  /** The host of the page, as in `location.hostname`. */
  readonly pageHost: string;
}) {
  return input.isPrimary && (input.desktop || isLocalLoopbackHost(input.pageHost));
}

/**
 * Whether Claude signs in with a link and a pasted code instead of the CLI in a terminal. The
 * CLI opens a browser on the machine it runs on, which reaches the owner only on their own
 * computer.
 */
export function claudeSignsInByLink(input: {
  readonly majordome: boolean;
  readonly desktop: boolean;
  readonly isPrimary: boolean;
  /** The host of the page, as in `location.hostname`. */
  readonly pageHost: string;
  readonly provider: Pick<ServerProvider, "driver" | "installed">;
}) {
  return (
    input.majordome &&
    input.provider.driver === "claudeAgent" &&
    input.provider.installed &&
    !isOwnComputer(input)
  );
}

const MAJORDOME_AI_DRIVERS: ReadonlyArray<string> = MAJORDOME_AIS.map((ai) => ai.driver);

/** An account the owner named keeps its name. */
export function majordomeAiName(provider: Pick<ServerProvider, "driver">, name: string) {
  return name === PROVIDER_DISPLAY_NAMES[provider.driver]
    ? majordomeAiDriverName(provider.driver, name)
    : name;
}

/**
 * Majordome's assistant list. Claude, ChatGPT and Gemini come first and in that order, each
 * shown before it is set up; an AI with an account already on the computer shows those accounts.
 * A server Majordome hosts lists nothing else.
 */
export function majordomeWelcomeAgents(
  agents: {
    readonly found: ReadonlyArray<ServerProvider>;
    readonly available: ReadonlyArray<ServerProvider>;
  },
  options: { readonly hosted: boolean },
) {
  const offered = MAJORDOME_AI_DRIVERS.flatMap((driver) => {
    const found = agents.found.filter((provider) => provider.driver === driver);
    if (found.length > 0) return found;
    const candidates = agents.available.filter((provider) => provider.driver === driver);
    return candidates.slice(0, 1);
  });
  const others = (providers: ReadonlyArray<ServerProvider>) =>
    providers.filter((provider) => !offered.includes(provider));
  return {
    listed: options.hosted ? offered : [...offered, ...others(agents.found)],
    more: options.hosted ? [] : others(agents.available),
  };
}

/**
 * Whether Gemini's row opens its setup card, which turns it on, installs it and signs in. Gemini
 * is off until asked for, so its card also covers an account that is not turned on yet.
 */
export function geminiNeedsSetup(
  provider: ServerProvider,
  settings: ComputerSettings | null | undefined,
) {
  if (
    provider.driver !== "antigravity" ||
    provider.auth.status === "authenticated" ||
    isBrokenVersion(provider)
  ) {
    return false;
  }
  const state = welcomeAgentState(provider, settings);
  return (
    state === "disabled" ||
    state === "install" ||
    state === "signIn" ||
    (state === "attention" && isProviderAvailable(provider))
  );
}

const RUNNING_INSTALL_PHASES: ReadonlySet<string> = new Set([
  "downloading",
  "extracting",
  "verifying",
]);

/**
 * What Gemini's setup card shows. The download reports itself apart from the account's status,
 * which takes a moment to notice a finished install, so a version on disk counts as installed.
 */
export function geminiSetupStep(input: {
  readonly provider: ServerProvider;
  readonly settings: ComputerSettings | null | undefined;
  readonly install: Pick<ProviderInstallState, "phase" | "installedVersion"> | null;
}) {
  const state = welcomeAgentState(input.provider, input.settings);
  if (state === "disabled") return "checking";
  if (input.install !== null && RUNNING_INSTALL_PHASES.has(input.install.phase)) {
    return "installing";
  }
  if (state === "ready" || input.provider.auth.status === "authenticated") return "done";
  if (input.provider.installed || input.install?.installedVersion != null) return "signIn";
  if (state === "checking" || input.install === null) return "checking";
  return input.install.phase === "failed" ? "installFailed" : "install";
}

/**
 * The Codex instance the setup card shows, or null when the card is closed. A rebuild briefly
 * drops an instance from the list, so the card keeps its last status meanwhile instead of
 * unmounting and losing a sign-in in progress.
 */
export function codexCardProvider(input: SetupCardInput) {
  return setupCardProvider(input, codexNeedsSetup);
}

/** Gemini's setup card, kept through a rebuild the way Codex's is. */
export function geminiCardProvider(input: SetupCardInput) {
  return setupCardProvider(input, geminiNeedsSetup);
}

interface SetupCardInput {
  readonly providers: ReadonlyArray<ServerProvider> | null | undefined;
  readonly instanceId: ProviderInstanceId | null;
  readonly last: ServerProvider | null;
  readonly settings: ComputerSettings | null | undefined;
}

function setupCardProvider(
  input: SetupCardInput,
  needsSetup: (provider: ServerProvider, settings: ComputerSettings | null | undefined) => boolean,
) {
  if (input.instanceId === null) return null;
  const provider =
    input.providers?.find((candidate) => candidate.instanceId === input.instanceId) ??
    (input.last?.instanceId === input.instanceId ? input.last : undefined);
  if (provider === undefined) return null;
  const open =
    needsSetup(provider, input.settings) ||
    welcomeAgentState(provider, input.settings) === "checking";
  return open ? provider : null;
}

export type WelcomeTurn = "name" | "assistant" | "notes" | "firstAsk";

/**
 * Which question Majordome's setup is on. A notes folder ends the setup questions whatever came
 * before it: one restored from a backup arrives without the earlier answers.
 */
export function welcomeTurn(input: {
  readonly named: boolean;
  /** An AI is ready and no install or sign-in is still running. */
  readonly assistantSettled: boolean;
  readonly assistantSkipped: boolean;
  readonly hasNotes: boolean;
}): WelcomeTurn {
  if (input.hasNotes) return "firstAsk";
  if (!input.named) return "name";
  if (!input.assistantSettled && !input.assistantSkipped) return "assistant";
  return "notes";
}
