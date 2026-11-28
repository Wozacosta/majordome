import type {
  ProviderInstanceConfig,
  ProviderInstanceMutation,
  ServerProvider,
} from "@t3tools/contracts";
import { getOnboardingProviderState } from "@t3tools/shared/claudeSignIn";
import { MAJORDOME_AIS } from "@t3tools/shared/majordome";

/** The AIs the assistant can run on, as Majordome names and orders them. */
export const ASSISTANT_AIS = MAJORDOME_AIS;

export type AssistantAiState = ReturnType<typeof getOnboardingProviderState>;

export interface AssistantAi {
  readonly name: string;
  readonly provider: ServerProvider;
  readonly state: AssistantAiState;
}

export function assistantAiName(provider: Pick<ServerProvider, "driver" | "displayName">): string {
  return (
    ASSISTANT_AIS.find((ai) => ai.driver === provider.driver)?.name ??
    provider.displayName ??
    provider.driver
  );
}

/** An account's name in a list: its AI's for the first of its kind, its own for another. */
export function assistantAccountName(
  provider: Pick<ServerProvider, "driver" | "instanceId" | "displayName">,
): string {
  const ai = ASSISTANT_AIS.find((entry) => entry.driver === provider.driver);
  return ai !== undefined && provider.instanceId === ai.driver
    ? ai.name
    : (provider.displayName ?? assistantAiName(provider));
}

/**
 * Where an AI stands. An account that signs in from the phone can report a sign-in it has not
 * checked yet as a warning, which is a sign-in still to do.
 */
export function assistantAiState(provider: ServerProvider): AssistantAiState {
  const state = getOnboardingProviderState(provider);
  return state === "attention" &&
    provider.setup?.canAuthenticate === true &&
    provider.auth.status !== "authenticated"
    ? "signIn"
    : state;
}

/** One account for each AI the computer lists: a ready one, else its first, Claude leading. */
export function assistantAis(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): ReadonlyArray<AssistantAi> {
  return ASSISTANT_AIS.flatMap(({ driver, name }) => {
    const accounts = (providers ?? []).filter((provider) => provider.driver === driver);
    const provider =
      accounts.find((account) => assistantAiState(account) === "ready") ??
      accounts.find((account) => account.instanceId === driver) ??
      accounts[0];
    return provider === undefined ? [] : [{ name, provider, state: assistantAiState(provider) }];
  });
}

/**
 * Whether the assistant can answer on this computer. `choose` is when no AI is signed in and one
 * can be; `attention` when an account is there and not working, which a sign-in would not fix.
 */
export type AssistantStanding = "checking" | "ready" | "choose" | "attention";

export function assistantStanding(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): AssistantStanding {
  if (providers == null) return "checking";
  const states = providers.map(assistantAiState);
  if (states.includes("ready")) return "ready";
  const offered = assistantAis(providers).map((ai) => ai.state);
  if (offered.includes("checking")) return "checking";
  return offered.length === 0 || offered.includes("attention") ? "attention" : "choose";
}

/** The AIs the phone's setup lists: the ones that answer once any does, else all of them. */
export function listedAssistantAis(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): ReadonlyArray<AssistantAi> {
  const ais = assistantAis(providers);
  const ready = ais.filter((ai) => ai.state === "ready");
  return ready.length > 0 ? ready : ais;
}

/** The account new chats run on: the one Everyday names while it is ready, else the first ready. */
export function assistantInUse(
  providers: ReadonlyArray<ServerProvider>,
  everydayInstanceId: string | null | undefined,
): ServerProvider | undefined {
  const ready = providers.filter((provider) => assistantAiState(provider) === "ready");
  return ready.find((provider) => provider.instanceId === everydayInstanceId) ?? ready[0];
}

/**
 * How the phone shows an AI other than Claude: a first step that turns it on, its account with
 * install and sign-in, or its name alone when it was signed in on the computer itself.
 */
export function aiAccountKind(provider: ServerProvider): "setUp" | "account" | "signedInElsewhere" {
  if (!provider.enabled) return "setUp";
  if (provider.setup?.canAuthenticate === true) return "account";
  if (provider.driver === "codex" && assistantAiState(provider) !== "ready") return "setUp";
  return provider.driver === "acpRegistry" && provider.installed ? "account" : "signedInElsewhere";
}

/** Turns an AI on for this computer. ChatGPT also moves to the sign-in a phone can do. */
export function turnOnAiMutation(
  provider: Pick<ServerProvider, "driver" | "instanceId">,
  saved: ProviderInstanceConfig | undefined,
): ProviderInstanceMutation {
  const instance = saved ?? { driver: provider.driver };
  const config =
    typeof instance.config === "object" && instance.config !== null ? instance.config : {};
  return {
    operation: "upsert",
    instanceId: provider.instanceId,
    instance: {
      ...instance,
      enabled: true,
      config: {
        ...config,
        enabled: true,
        ...(provider.driver === "codex" ? { setupMode: "managed" } : {}),
      },
    },
  };
}

export interface AiInstallProgress {
  readonly phase: string;
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
}

/** What an AI's install is doing; `downloaded` and `total` in MB while it downloads. */
export function aiInstallStep(
  install: AiInstallProgress | null | undefined,
):
  | { readonly kind: "idle" | "installing" }
  | { readonly kind: "downloading"; readonly downloaded: string; readonly total: string | null } {
  if (install?.phase === "downloading") {
    const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(0);
    return {
      kind: "downloading",
      downloaded: megabytes(install.downloadedBytes),
      total:
        install.totalBytes === null || install.totalBytes === 0
          ? null
          : megabytes(install.totalBytes),
    };
  }
  return install?.phase === "extracting" || install?.phase === "verifying"
    ? { kind: "installing" }
    : { kind: "idle" };
}

/** What Settings' AI row says of one connected computer. */
export type ComputerAiStanding =
  | { readonly state: "checking" | "signIn" | "attention" }
  | { readonly state: "ready"; readonly name: string };

export function computerAiStanding(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
  everydayInstanceId: string | null | undefined,
): ComputerAiStanding {
  const inUse = assistantInUse(providers ?? [], everydayInstanceId);
  if (inUse !== undefined) return { state: "ready", name: assistantAiName(inUse) };
  const standing = assistantStanding(providers);
  return {
    state: standing === "choose" ? "signIn" : standing === "checking" ? "checking" : "attention",
  };
}
