import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type {
  MajordomeBackupStatus,
  MajordomeConnectorsResult,
  ProviderConnector,
  ServerProvider,
} from "@t3tools/contracts";

import { machineInSentence } from "./brains.logic";

export interface ConnectionState {
  readonly label: string;
  readonly tone: "ok" | "warning" | "neutral";
  /** The provider's own words for a problem, shown under the row. */
  readonly detail?: string;
}

const CONNECTED: ConnectionState = { label: "Connected", tone: "ok" };
const NEEDS_SIGN_IN: ConnectionState = { label: "Needs sign-in", tone: "warning" };
const NOT_SET_UP: ConnectionState = { label: "Not set up", tone: "neutral" };

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

function signedOut(provider: ServerProvider): boolean {
  return provider.auth.status === "unauthenticated";
}

/** Whether the provider can be used on its machine, in the words of its own problem if not. */
function providerState(provider: ServerProvider): ConnectionState {
  if (!provider.installed) return { label: "Not installed", tone: "neutral" };
  if (signedOut(provider)) return { label: "Not signed in", tone: "warning" };
  const detail = provider.message === undefined ? {} : { detail: provider.message };
  if (provider.status === "error") return { label: "Not working", tone: "warning", ...detail };
  return {
    label: provider.auth.status === "authenticated" ? "Signed in" : "Ready",
    tone: "ok",
    // A warning leaves the provider usable, so it keeps its state and adds the provider's note.
    ...(provider.status === "warning" ? detail : {}),
  };
}

export function aiRows(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<{ readonly key: string; readonly name: string; readonly state: ConnectionState }> {
  return providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      key: provider.instanceId,
      name: resolveProviderInstanceDisplayName(provider),
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
}): ConnectorsView {
  const snapshotOf = (instanceId: string) =>
    input.snapshots?.find((snapshot) => snapshot.instanceId === instanceId);
  // A provider that is not installed has nothing to say here; the AI list already shows it.
  const providers = input.result.providers
    .filter((provider) => snapshotOf(provider.instanceId)?.installed !== false)
    .map((provider) => ({
      ...provider,
      name: resolveProviderInstanceDisplayName(snapshotOf(provider.instanceId) ?? provider),
    }));
  const reporting = providers.filter((provider) => provider.reported);
  const several = reporting.length > 1;
  const where = input.machine === null ? "this machine" : machineInSentence(input.machine);

  const rows = reporting.flatMap((provider) =>
    provider.connectors.map((connector) => ({
      key: `${provider.instanceId}:${connector.name}`,
      name: connectorName(connector.name),
      provider: several ? provider.name : null,
      state: connectorState(connector.status),
    })),
  );

  const warnings = reporting.flatMap((provider) => {
    if (provider.error !== undefined) {
      return [`Majordome couldn't check ${provider.name}'s connectors. ${provider.error}`];
    }
    const snapshot = snapshotOf(provider.instanceId);
    // Signed out, the missing connectors are not the news.
    if (provider.connectors.length > 0 || (snapshot !== undefined && signedOut(snapshot))) {
      return [];
    }
    return [
      several
        ? `${provider.name} has no connectors on ${where}. Conversations and routines that use it here can't reach your email, calendar or files.`
        : `No connectors on ${where}. Conversations and routines that run here can't reach your email, calendar or files.`,
    ];
  });

  const unseen = providers.filter((provider) => !provider.reported).map(({ name }) => name);
  return {
    rows,
    warnings,
    notes: unseen.length === 0 ? [] : [`Majordome can't see the connectors of ${listed(unseen)}.`],
  };
}

// These sign in with a key or another cloud, where a Claude account's connectors never apply.
const KEYED_CLAUDE_SIGN_INS = new Set(["apiKey", "bedrock", "customEndpoint"]);

/**
 * The Claude providers on a machine that a full sign-in would help: signed out, or signed in
 * with no connectors, which is what a sign-in token gives.
 */
export function claudeSignInTargets(input: {
  readonly result: MajordomeConnectorsResult;
  readonly snapshots: ReadonlyArray<ServerProvider> | null;
}): ReadonlyArray<{ readonly instanceId: ServerProvider["instanceId"]; readonly name: string }> {
  return (input.snapshots ?? [])
    .filter((snapshot) => {
      if (snapshot.driver !== "claudeAgent" || !snapshot.enabled || !snapshot.installed) {
        return false;
      }
      if (signedOut(snapshot)) return true;
      const listed = input.result.providers.find(
        (provider) => provider.instanceId === snapshot.instanceId,
      );
      return (
        snapshot.auth.status === "authenticated" &&
        !KEYED_CLAUDE_SIGN_INS.has(snapshot.auth.type ?? "") &&
        listed?.reported === true &&
        listed.error === undefined &&
        listed.connectors.length === 0
      );
    })
    .map((snapshot) => ({
      instanceId: snapshot.instanceId,
      name: resolveProviderInstanceDisplayName(snapshot),
    }));
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
