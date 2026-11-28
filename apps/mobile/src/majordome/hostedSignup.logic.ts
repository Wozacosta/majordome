/** The account's Majordome server, as the service answers. */
export interface HostedServer {
  readonly name: string;
  readonly url: string;
  /**
   * Connects one device as the server's owner. Works once, for a day. Null for a server made
   * earlier, and on a phone that no longer holds it: the phone then connects through the account.
   */
  readonly pairingUrl: string | null;
}

/** What the phone's file keeps between making a server and finishing its setup. Never the link. */
export interface SignupProgress {
  readonly server: Pick<HostedServer, "name" | "url">;
  /** Set once this phone is connected to the server. */
  readonly environmentId: string | null;
}

/** What the screen says once a try ends without a server; `hasServer` offers to connect instead. */
export interface SignupNote {
  readonly kind: "error" | "info" | "hasServer";
  readonly message: string;
}

type PayingStep = "checking" | "buying" | "confirming" | "restoring";

export type SignupState =
  | { readonly step: "idle"; readonly note: SignupNote | null }
  | { readonly step: "paying"; readonly doing: PayingStep }
  | { readonly step: "making" }
  | { readonly step: "waiting"; readonly server: HostedServer }
  | { readonly step: "pairing"; readonly server: HostedServer }
  /** The server exists; only connecting this phone is left to try. */
  | { readonly step: "made"; readonly server: HostedServer; readonly error: string | null }
  | { readonly step: "finishing"; readonly server: HostedServer; readonly environmentId: string }
  | { readonly step: "done" };

export type SignupEvent =
  | { readonly type: "pay"; readonly doing: PayingStep }
  | { readonly type: "submit" }
  | { readonly type: "made"; readonly server: HostedServer }
  | { readonly type: "stopped"; readonly note: SignupNote | null }
  | { readonly type: "ready" }
  | { readonly type: "retryPairing" }
  /** `fresh` is a server made just now, which still has its setup to finish. */
  | { readonly type: "paired"; readonly environmentId: string; readonly fresh: boolean }
  | { readonly type: "pairingFailed"; readonly message: string }
  | { readonly type: "finished" }
  | {
      readonly type: "resumed";
      readonly progress: SignupProgress | null;
      readonly pairingUrl: string | null;
    };

export const SIGNUP_IDLE: SignupState = { step: "idle", note: null };

/** Where a signup stands after an event. An event that does not fit the step changes nothing. */
export function signupNext(state: SignupState, event: SignupEvent): SignupState {
  switch (event.type) {
    case "pay":
      return state.step === "idle" || state.step === "paying"
        ? { step: "paying", doing: event.doing }
        : state;
    case "submit":
      return state.step === "idle" || state.step === "paying" ? { step: "making" } : state;
    case "made":
      return state.step === "making" ? { step: "waiting", server: event.server } : state;
    case "stopped":
      return state.step === "paying" || state.step === "making"
        ? { step: "idle", note: event.note }
        : state;
    case "ready":
      return state.step === "waiting" ? { step: "pairing", server: state.server } : state;
    case "retryPairing":
      return state.step === "made" ? { step: "pairing", server: state.server } : state;
    case "paired":
      if (state.step !== "pairing") return state;
      return event.fresh
        ? { step: "finishing", server: state.server, environmentId: event.environmentId }
        : { step: "done" };
    case "pairingFailed":
      return state.step === "pairing"
        ? { step: "made", server: state.server, error: event.message }
        : state;
    case "finished":
      return state.step === "finishing" ? { step: "done" } : state;
    case "resumed": {
      // What is on screen wins over the phone's copy, which a run in progress already wrote.
      if (state.step !== "idle" || event.progress === null) return state;
      const server = { ...event.progress.server, pairingUrl: event.pairingUrl };
      const { environmentId } = event.progress;
      return environmentId === null
        ? { step: "made", server, error: null }
        : { step: "finishing", server, environmentId };
    }
  }
}

export type SetupStepStatus = "done" | "now" | "later";

/**
 * How far setting up a server is, as the page lists it: subscribed, server made, Majordome
 * started, this phone connected. Null for a state the list does not cover.
 */
export function setupSteps(
  state: SignupState,
): readonly [SetupStepStatus, SetupStepStatus, SetupStepStatus, SetupStepStatus] | null {
  const now =
    state.step === "making"
      ? 1
      : state.step === "waiting"
        ? 2
        : state.step === "pairing"
          ? 3
          : state.step === "done"
            ? 4
            : null;
  if (now === null) return null;
  const status = (step: number): SetupStepStatus =>
    step < now ? "done" : step === now ? "now" : "later";
  return [status(0), status(1), status(2), status(3)];
}

/** What to keep in the phone's file for a state: a made server until its setup is finished. */
export function signupProgress(state: SignupState): SignupProgress | null {
  switch (state.step) {
    case "waiting":
    case "pairing":
    case "made":
    case "finishing": {
      const { name, url } = state.server;
      return {
        server: { name, url },
        environmentId: state.step === "finishing" ? state.environmentId : null,
      };
    }
    default:
      return null;
  }
}

/** The link to keep in the phone's secure storage for a state: only while it is still to be used. */
export function signupPairingUrl(state: SignupState): string | null {
  switch (state.step) {
    case "waiting":
    case "pairing":
    case "made":
      return state.server.pairingUrl;
    default:
      return null;
  }
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The phone's copy as read back from its file; null when it is not one. */
export function readSignupProgress(stored: unknown): SignupProgress | null {
  if (typeof stored !== "object" || stored === null) return null;
  const { server, environmentId } = stored as { server?: unknown; environmentId?: unknown };
  if (typeof server !== "object" || server === null) return null;
  const { name, url } = server as Record<string, unknown>;
  if (!isText(name) || !isText(url)) return null;
  return { server: { name, url }, environmentId: isText(environmentId) ? environmentId : null };
}

/** The link an earlier version wrote into the file, to move into secure storage. */
export function storedPairingUrl(stored: unknown): string | null {
  const server =
    typeof stored === "object" && stored !== null ? (stored as { server?: unknown }).server : null;
  const pairingUrl =
    typeof server === "object" && server !== null
      ? (server as { pairingUrl?: unknown }).pairingUrl
      : null;
  return isText(pairingUrl) ? pairingUrl : null;
}

function readHostedServer(body: unknown): HostedServer | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, url, pairingUrl } = body as Record<string, unknown>;
  return isText(name) && isText(url)
    ? { name, url, pairingUrl: isText(pairingUrl) ? pairingUrl : null }
    : null;
}

const DEFAULT_BROKER_URL = "https://broker.majord.link";

/** Where the service that makes servers answers, without a trailing slash. */
export function brokerUrl(override: string | undefined): string {
  const trimmed = (override ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? DEFAULT_BROKER_URL : trimmed;
}

const MAKING_FAILED =
  "Majordome couldn't make your server just now. Your subscription is kept: try again in a few minutes.";
const SIGNUP_ERRORS: Readonly<Record<string, string>> = {
  invalid_account: "Your sign-in ended. Sign in again, then try once more.",
  not_paid: "This account has no Majordome server yet.",
  full: MAKING_FAILED,
  rate_limited: "Too many tries. Wait a few minutes, then try again.",
  upstream: MAKING_FAILED,
};
const UNKNOWN_ERROR = "That did not work. Try again in a few minutes.";
export const NO_ANSWER_ERROR =
  "Majordome couldn't be reached. Check this phone's internet connection and try again.";

/** Why the service refused, in one sentence the person can act on. */
export function signupErrorMessage(body: unknown): string {
  const code =
    typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  return (typeof code === "string" ? SIGNUP_ERRORS[code] : undefined) ?? UNKNOWN_ERROR;
}

export type Fetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly cache?: "no-store";
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>;

/** One question to the service; null when it could not be reached. */
export async function askBroker(
  fetch: Fetch,
  broker: string,
  path: string,
  fields: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: unknown } | null> {
  try {
    const response = await fetch(`${broker}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

export type MakeServerResult =
  | { readonly ok: true; readonly server: HostedServer }
  | { readonly ok: false; readonly message: string };

/** The paid account's server: made now, or the one made earlier, which comes without a link. */
export async function makeHostedServer(
  fetch: Fetch,
  broker: string,
  accountToken: string,
): Promise<MakeServerResult> {
  const answer = await askBroker(fetch, broker, "/v1/hosted", { accountToken });
  if (answer === null) return { ok: false, message: NO_ANSWER_ERROR };
  if (answer.status >= 400) return { ok: false, message: signupErrorMessage(answer.body) };
  const server = readHostedServer(answer.body);
  return server === null ? { ok: false, message: UNKNOWN_ERROR } : { ok: true, server };
}

/** Whether one of this phone's connections already reaches the server at `serverUrl`. */
export function alreadyConnected(
  serverUrl: string,
  connectionUrls: ReadonlyArray<string>,
): boolean {
  const host = hostOf(serverUrl);
  return host !== null && connectionUrls.some((url) => hostOf(url) === host);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// The service's own page waits the same way: a new server takes about half a minute.
export const READY_ATTEMPTS = 60;
export const READY_WAIT_MS = 3000;

/**
 * Waits until the new server answers. It gives up quietly after three minutes, since connecting
 * says more about what is wrong than waiting longer would.
 */
export async function waitUntilReady(
  fetch: Fetch,
  broker: string,
  name: string,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const ready = await fetch(`${broker}/v1/hosted/ready?name=${encodeURIComponent(name)}`, {
      cache: "no-store",
    })
      .then((answer) => answer.json())
      .then((answer) => (answer as { ready?: unknown } | null)?.ready === true)
      .catch(() => false);
    if (ready) return true;
    await wait(READY_WAIT_MS);
  }
  return false;
}

/** The server's own page, opened signed in with a one-time code; null for an address that is not one. */
export function setupPageUrl(serverUrl: string, token: string): string | null {
  try {
    const url = new URL(serverUrl);
    url.pathname = "/pair";
    url.search = "";
    url.hash = new URLSearchParams([["token", token]]).toString();
    return url.toString();
  } catch {
    return null;
  }
}
