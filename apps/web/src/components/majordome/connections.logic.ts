import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type {
  MajordomeBackupStatus,
  MajordomeConnectionsResult,
  MajordomeConnectorsResult,
  ProviderConnector,
  ServerProvider,
} from "@t3tools/contracts";

import { majordomeAiName } from "../../onboarding/welcomePage.logic";
import { machineInSentence } from "./brains.logic";

export interface ConnectionState {
  readonly label: string;
  readonly tone: "ok" | "warning" | "neutral";
  /** The provider's own words for a problem, shown under the row. */
  readonly detail?: string;
  /** Signing in is what fixes it, so the page can point at where to do that. */
  readonly needsSignIn?: true;
}

const CONNECTED: ConnectionState = { label: "Connected", tone: "ok" };
const NEEDS_SIGN_IN: ConnectionState = {
  label: "Needs sign-in",
  tone: "warning",
  needsSignIn: true,
};
const NOT_SET_UP: ConnectionState = { label: "Not set up", tone: "neutral" };

/** Where a Claude account's connectors are added and signed in to; a computer signed in to it gets them. */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/customize/connectors";

/** A connector as a person names it: "claude.ai Gmail" is Gmail, "plugin:vercel:vercel" is vercel. */
export function connectorName(raw: string): string {
  const name = raw.trim();
  const plugin = /^plugin:(?:.*:)?([^:]+)$/.exec(name);
  if (plugin) return plugin[1]!;
  return name.replace(/^claude\.ai\s+/i, "") || name;
}

export function connectorState(status: ProviderConnector["status"]): ConnectionState {
  switch (status) {
    case "connected":
      return CONNECTED;
    case "needs-auth":
      return NEEDS_SIGN_IN;
    case "failed":
      return { label: "Not working", tone: "warning" };
    case "disabled":
      return { label: "Turned off", tone: "neutral" };
    case "pending":
      return { label: "Checking", tone: "neutral" };
  }
}

function aiName(provider: Pick<ServerProvider, "instanceId" | "driver" | "displayName">): string {
  return majordomeAiName(provider, resolveProviderInstanceDisplayName(provider));
}

function signedOut(provider: ServerProvider): boolean {
  return provider.auth.status === "unauthenticated";
}

/** Whether the provider can be used on its machine, in the words of its own problem if not. */
function providerState(provider: ServerProvider): ConnectionState {
  if (!provider.installed) return { label: "Not installed", tone: "neutral" };
  if (signedOut(provider)) {
    return { label: "Not signed in", tone: "warning", needsSignIn: true };
  }
  const detail = provider.message === undefined ? {} : { detail: provider.message };
  if (provider.status === "error") return { label: "Not working", tone: "warning", ...detail };
  return {
    label: provider.auth.status === "authenticated" ? "Signed in" : "Ready",
    tone: "ok",
    // A warning leaves the provider usable, so it keeps its state and adds the provider's note.
    ...(provider.status === "warning" ? detail : {}),
  };
}

/** What a service's one button says: what fixes it when something is missing, else "Manage". */
export function connectionAction(state: ConnectionState): "Sign in" | "Set up" | "Manage" {
  if (state.needsSignIn) return "Sign in";
  return state === NOT_SET_UP ? "Set up" : "Manage";
}

export function aiRows(providers: ReadonlyArray<ServerProvider>): ReadonlyArray<{
  readonly key: ServerProvider["instanceId"];
  readonly name: string;
  readonly driver: ServerProvider["driver"];
  readonly accentColor: string | undefined;
  readonly state: ConnectionState;
}> {
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      key: provider.instanceId,
      name: aiName(provider),
      driver: provider.driver,
      accentColor: provider.accentColor,
      state: providerState(provider),
    }));
}

/** A server from before this page answers a request it does not know with this defect. */
export function isUnknownRequest(error: unknown): boolean {
  return typeof error === "string" && error.startsWith("Unknown request tag");
}

export interface ConnectorRow {
  readonly key: string;
  readonly name: string;
  /** Set when connectors from several providers are listed together. */
  readonly provider: string | null;
  readonly state: ConnectionState;
  /** The web page where this connector is signed in to, when it needs that and has one. */
  readonly signInUrl: string | null;
  /** The web page where this connector is added, signed in to and removed; null when there is none. */
  readonly manageUrl: string | null;
}

export interface ConnectorsView {
  readonly rows: ReadonlyArray<ConnectorRow>;
  /** A provider that should have connectors here and has none: what the owner cannot do. */
  readonly warnings: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
}

function listed(names: ReadonlyArray<string>): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * One machine's connectors, with what to say about the providers that list none.
 * `snapshots` are the machine's provider statuses, null until they are known; `machine` is the
 * machine's name where several are shown.
 */
export function connectorsView(input: {
  readonly result: MajordomeConnectorsResult;
  readonly snapshots: ReadonlyArray<ServerProvider> | null;
  readonly machine: string | null;
  /** An app connected through Majordome is something connected, whatever the AI accounts bring. */
  readonly appsConnected?: boolean;
}): ConnectorsView {
  const snapshotOf = (instanceId: string) =>
    input.snapshots?.find((snapshot) => snapshot.instanceId === instanceId);
  // A provider that is not installed has nothing to say here; the AI list already shows it.
  const providers = input.result.providers
    .filter((provider) => snapshotOf(provider.instanceId)?.installed !== false)
    .map((provider) => ({
      ...provider,
      name: aiName(snapshotOf(provider.instanceId) ?? provider),
    }));
  const reporting = providers.filter((provider) => provider.reported);
  const several = reporting.length > 1;
  const where = input.machine === null ? "this computer" : machineInSentence(input.machine);

  const rows = reporting.flatMap((provider) =>
    provider.connectors.map((connector) => {
      // Only the connectors of a Claude account are managed on the web.
      const manageUrl = /^claude\.ai\s/i.test(connector.name) ? CLAUDE_CONNECTORS_URL : null;
      return {
        key: `${provider.instanceId}:${connector.name}`,
        name: connectorName(connector.name),
        provider: several ? provider.name : null,
        state: connectorState(connector.status),
        signInUrl: connector.status === "needs-auth" ? manageUrl : null,
        manageUrl,
      };
    }),
  );

  const warnings = reporting.flatMap((provider) => {
    if (provider.error !== undefined) {
      return [`Majordome couldn't check what ${provider.name} is connected to. ${provider.error}`];
    }
    const snapshot = snapshotOf(provider.instanceId);
    // Signed out, the missing connectors are not the news.
    if (
      provider.connectors.length > 0 ||
      input.appsConnected === true ||
      (snapshot !== undefined && signedOut(snapshot))
    ) {
      return [];
    }
    return [
      several
        ? `${provider.name} has nothing connected on ${where}. Chats and routines that use it here can't reach your email, calendar or files.`
        : `Nothing is connected on ${where}. Chats and routines that run here can't reach your email, calendar or files.`,
    ];
  });

  const unseen = providers.filter((provider) => !provider.reported).map(({ name }) => name);
  return {
    rows,
    warnings,
    notes:
      unseen.length === 0
        ? []
        : [
            `Majordome can't see what ${listed(unseen)} ${unseen.length > 1 ? "are" : "is"} connected to.`,
          ],
  };
}

export interface AppRow {
  readonly appId: string;
  readonly name: string;
  readonly state: ConnectionState;
  readonly routinesMayChange: boolean;
}

/**
 * The apps connected through Majordome on one machine, and the ones that can still be added.
 * An app that left the list of apps stays shown while it is connected.
 */
export function appsView(result: MajordomeConnectionsResult): {
  readonly connected: ReadonlyArray<AppRow>;
  readonly addable: ReadonlyArray<MajordomeConnectionsResult["apps"][number]>;
} {
  const connected = result.connections
    .map((connection) => ({
      appId: connection.appId,
      name: connection.name,
      state: connection.state === "connected" ? CONNECTED : NEEDS_SIGN_IN,
      routinesMayChange: connection.routinesMayChange,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const taken = new Set(connected.map((row) => row.appId));
  return { connected, addable: result.apps.filter((app) => !taken.has(app.id)) };
}

/**
 * An app connected through Majordome is shown once: the copy a Claude account brings of the
 * same app is left out of the list, since Majordome's is the one every AI uses.
 */
export function withoutAppsConnectedHere(
  rows: ReadonlyArray<ConnectorRow>,
  connected: ReadonlyArray<AppRow>,
): ReadonlyArray<ConnectorRow> {
  const names = new Set(connected.map((row) => row.name.toLowerCase()));
  return rows.filter((row) => !names.has(row.name.toLowerCase()));
}

/** The address a person's browser reaches a server at, for a sign-in to come back to. */
export function serverOrigin(httpBaseUrl: string | null): string | null {
  if (httpBaseUrl === null) return null;
  try {
    return new URL(httpBaseUrl).origin;
  } catch {
    return null;
  }
}

// These sign in with a key or another cloud, where a Claude account's connectors never apply.
const KEYED_CLAUDE_SIGN_INS = new Set(["apiKey", "bedrock", "customEndpoint"]);

/**
 * The Claude providers on a machine with no connectors to show. `signed-out` needs a sign-in.
 * `no-connectors` is signed in: either the account has none yet, or it is signed in with a
 * token, which never brings them. Nothing here tells those two apart. An owner signed in to
 * another AI and not to Claude is not using Claude, so is not asked to sign in to it.
 */
export function claudeSignInTargets(input: {
  readonly result: MajordomeConnectorsResult;
  readonly snapshots: ReadonlyArray<ServerProvider> | null;
}): ReadonlyArray<{
  readonly instanceId: ServerProvider["instanceId"];
  readonly name: string;
  readonly reason: "signed-out" | "no-connectors";
}> {
  const usesAnotherAi = (input.snapshots ?? []).some(
    (snapshot) =>
      snapshot.driver !== "claudeAgent" &&
      snapshot.enabled &&
      snapshot.installed &&
      snapshot.auth.status === "authenticated",
  );
  return (input.snapshots ?? []).flatMap((snapshot) => {
    if (snapshot.driver !== "claudeAgent" || !snapshot.enabled || !snapshot.installed) return [];
    if (signedOut(snapshot) && usesAnotherAi) return [];
    const listed = input.result.providers.find(
      (provider) => provider.instanceId === snapshot.instanceId,
    );
    const noConnectors =
      snapshot.auth.status === "authenticated" &&
      !KEYED_CLAUDE_SIGN_INS.has(snapshot.auth.type ?? "") &&
      listed?.reported === true &&
      listed.error === undefined &&
      listed.connectors.length === 0;
    if (!signedOut(snapshot) && !noConnectors) return [];
    return [
      {
        instanceId: snapshot.instanceId,
        name: aiName(snapshot),
        reason: signedOut(snapshot) ? ("signed-out" as const) : ("no-connectors" as const),
      },
    ];
  });
}

/** Where one machine's notes are backed up to, across its notes folders. */
export function backupRows(
  statuses: ReadonlyArray<MajordomeBackupStatus>,
  options: { readonly elsewhere: boolean },
): ReadonlyArray<{ readonly key: string; readonly name: string; readonly state: ConnectionState }> {
  const best = (states: ReadonlyArray<ConnectionState>): ConnectionState =>
    states.find((state) => state === CONNECTED) ??
    states.find((state) => state === NEEDS_SIGN_IN) ??
    NOT_SET_UP;
  const github = best(
    statuses.map((status) =>
      status.remote?.isGitHub !== true
        ? NOT_SET_UP
        : status.github.signedIn
          ? CONNECTED
          : NEEDS_SIGN_IN,
    ),
  );
  const drive = best(
    statuses.map((status) =>
      status.drive === null
        ? NOT_SET_UP
        : status.googleDrive.signedIn && status.drive.problem !== "signed-out"
          ? CONNECTED
          : NEEDS_SIGN_IN,
    ),
  );
  const folder = best(statuses.map((status) => (status.folder === null ? NOT_SET_UP : CONNECTED)));
  return [
    { key: "github", name: "GitHub", state: github },
    { key: "google-drive", name: "Google Drive", state: drive },
    // A folder on another machine, such as a server, isn't the iCloud or USB drive meant here.
    ...(options.elsewhere && folder !== CONNECTED
      ? []
      : [{ key: "folder", name: "Folder backup", state: folder }]),
  ];
}
