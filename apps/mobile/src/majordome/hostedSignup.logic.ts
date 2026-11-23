/** A server Majordome made for an invite code, as the service answers. */
export interface HostedServer {
  readonly name: string;
  readonly url: string;
  /** Connects one device as the server's owner. Works once, for a day. */
  readonly pairingUrl: string;
}

/** What is kept on the phone between making a server and finishing its setup. */
export interface SignupProgress {
  readonly server: HostedServer;
  /** Set once this phone is connected to the server. */
  readonly environmentId: string | null;
}

export type SignupState =
  | { readonly step: "idle"; readonly error: string | null }
  | { readonly step: "making" }
  | { readonly step: "waiting"; readonly server: HostedServer }
  | { readonly step: "pairing"; readonly server: HostedServer }
  /** The server exists and the code is spent; only connecting this phone is left to try. */
  | { readonly step: "made"; readonly server: HostedServer; readonly error: string | null }
  | { readonly step: "finishing"; readonly server: HostedServer; readonly environmentId: string }
  | { readonly step: "done" };

export type SignupEvent =
  | { readonly type: "submit" }
  | { readonly type: "made"; readonly server: HostedServer }
  | { readonly type: "refused"; readonly message: string }
  | { readonly type: "ready" }
  | { readonly type: "retryPairing" }
  | { readonly type: "paired"; readonly environmentId: string }
  | { readonly type: "pairingFailed"; readonly message: string }
  | { readonly type: "finished" }
  | { readonly type: "resumed"; readonly progress: SignupProgress | null };

export const SIGNUP_IDLE: SignupState = { step: "idle", error: null };

/** Where a signup stands after an event. An event that does not fit the step changes nothing. */
export function signupNext(state: SignupState, event: SignupEvent): SignupState {
  switch (event.type) {
    case "submit":
      return state.step === "idle" ? { step: "making" } : state;
    case "made":
      return state.step === "making" ? { step: "waiting", server: event.server } : state;
    case "refused":
      return state.step === "making" ? { step: "idle", error: event.message } : state;
    case "ready":
      return state.step === "waiting" ? { step: "pairing", server: state.server } : state;
    case "retryPairing":
      return state.step === "made" ? { step: "pairing", server: state.server } : state;
    case "paired":
      return state.step === "pairing"
        ? { step: "finishing", server: state.server, environmentId: event.environmentId }
        : state;
    case "pairingFailed":
      return state.step === "pairing"
        ? { step: "made", server: state.server, error: event.message }
        : state;
    case "finished":
      return state.step === "finishing" ? { step: "done" } : state;
    case "resumed": {
      // What is on screen wins over the phone's copy, which a run in progress already wrote.
      if (state.step !== "idle" || event.progress === null) return state;
      const { server, environmentId } = event.progress;
      return environmentId === null
        ? { step: "made", server, error: null }
        : { step: "finishing", server, environmentId };
    }
  }
}

/** What to keep on the phone for a state: a made server until its setup is finished. */
export function signupProgress(state: SignupState): SignupProgress | null {
  switch (state.step) {
    case "waiting":
    case "pairing":
    case "made":
      return { server: state.server, environmentId: null };
    case "finishing":
      return { server: state.server, environmentId: state.environmentId };
    default:
      return null;
  }
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The phone's copy as read back from its file; null when it is not one. */
export function readSignupProgress(stored: unknown): SignupProgress | null {
  if (typeof stored !== "object" || stored === null) return null;
  const { server, environmentId } = stored as { server?: unknown; environmentId?: unknown };
  const made = readHostedServer(server);
  if (made === null) return null;
  return { server: made, environmentId: isText(environmentId) ? environmentId : null };
}

function readHostedServer(body: unknown): HostedServer | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, url, pairingUrl } = body as Record<string, unknown>;
  return isText(name) && isText(url) && isText(pairingUrl) ? { name, url, pairingUrl } : null;
}

const DEFAULT_BROKER_URL = "https://broker.majord.link";

/** Where the service that makes servers answers, without a trailing slash. */
export function brokerUrl(override: string | undefined): string {
  const trimmed = (override ?? "").trim().replace(/\/+$/, "");
  return trimmed === "" ? DEFAULT_BROKER_URL : trimmed;
}

const SIGNUP_ERRORS: Readonly<Record<string, string>> = {
  invalid_invite: "That invite code isn't valid, or it was already used. Check it and try again.",
  full: "Majordome isn't taking new servers right now. Your code is still good: try again later.",
  rate_limited: "Too many tries. Wait a few minutes, then try again.",
  upstream:
    "Majordome couldn't make your server just now. Your code is still good: try again in a few minutes.",
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

type Fetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly cache?: "no-store";
  },
) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>;

export type MakeServerResult =
  | { readonly ok: true; readonly server: HostedServer }
  | { readonly ok: false; readonly message: string };

/** Spends an invite code on a new server. The service gives the code back when it makes none. */
export async function makeHostedServer(
  fetch: Fetch,
  broker: string,
  invite: string,
): Promise<MakeServerResult> {
  let response: Awaited<ReturnType<Fetch>>;
  try {
    response = await fetch(`${broker}/v1/hosted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite: invite.trim() }),
    });
  } catch {
    return { ok: false, message: NO_ANSWER_ERROR };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, message: signupErrorMessage(body) };
  const server = readHostedServer(body);
  return server === null ? { ok: false, message: UNKNOWN_ERROR } : { ok: true, server };
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
