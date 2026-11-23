import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AuthAccessWriteScope, AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { buildPairingUrl, parsePairingUrl } from "../features/connection/pairing";
import { writeFileAtomically } from "../lib/atomic-file";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import { appAtomRegistry } from "../state/atom-registry";
import { authEnvironment } from "../state/auth";
import { readEnvironmentScope } from "../state/session";
import {
  pairEnvironment,
  savedConnectionsByIdAtom,
} from "../state/use-remote-environment-registry";
import { connectErrorForOwner } from "./connectWording";
import {
  brokerUrl,
  makeHostedServer,
  readSignupProgress,
  setupPageUrl,
  SIGNUP_IDLE,
  signupNext,
  signupProgress,
  waitUntilReady,
  type HostedServer,
  type SignupEvent,
  type SignupState,
} from "./hostedSignup.logic";

// Spelled out in full: Expo only inlines `process.env.EXPO_PUBLIC_*` written this way.
const BROKER_URL = brokerUrl(process.env.EXPO_PUBLIC_MAJORDOME_BROKER_URL);
const FILE_NAME = "majordome-hosted-signup.json";

/** Outside React, so a signup under way carries on when its screen is closed. */
export const hostedSignupAtom = Atom.make<SignupState>(SIGNUP_IDLE).pipe(
  Atom.keepAlive,
  Atom.withLabel("majordome:hosted-signup"),
);

async function progressFile() {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, FILE_NAME);
}

let writing: Promise<void> = Promise.resolve();

function dispatch(event: SignupEvent): SignupState {
  const before = appAtomRegistry.get(hostedSignupAtom);
  const next = signupNext(before, event);
  if (next === before) return next;
  appAtomRegistry.set(hostedSignupAtom, next);
  const kept = JSON.stringify(signupProgress(next));
  if (kept !== JSON.stringify(signupProgress(before))) {
    writing = writing
      .then(async () => writeFileAtomically(await progressFile(), kept))
      .catch(() => undefined);
  }
  return next;
}

let loading: Promise<void> | null = null;

/** Picks up a server made earlier whose setup was not finished. */
export function loadHostedSignup(): Promise<void> {
  loading ??= (async () => {
    let stored: unknown = null;
    try {
      const file = await progressFile();
      if (file.exists) stored = JSON.parse(await file.text());
    } catch {
      // An unreadable copy is the same as none.
    }
    dispatch({ type: "resumed", progress: readSignupProgress(stored) });
  })();
  return loading;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function pair(server: HostedServer): Promise<void> {
  // The same spelling a scanned code is connected with.
  const { host, code } = parsePairingUrl(server.pairingUrl);
  const outcome = await pairEnvironment(buildPairingUrl(host, code));
  dispatch(
    outcome.ok && outcome.environmentId !== undefined
      ? { type: "paired", environmentId: outcome.environmentId }
      : {
          type: "pairingFailed",
          message:
            outcome.error === null
              ? "This phone couldn't connect to your server."
              : connectErrorForOwner(outcome.error),
        },
  );
}

/** Spends the invite code on a server, waits for it to start and connects this phone to it. */
export async function submitInvite(invite: string): Promise<void> {
  // Only the first of two presses gets past here: the state changes before anything is awaited.
  if (appAtomRegistry.get(hostedSignupAtom).step !== "idle") return;
  dispatch({ type: "submit" });
  const made = await makeHostedServer(fetch, BROKER_URL, invite);
  if (!made.ok) {
    dispatch({ type: "refused", message: made.message });
    return;
  }
  dispatch({ type: "made", server: made.server });
  await waitUntilReady(fetch, BROKER_URL, made.server.name, wait);
  dispatch({ type: "ready" });
  await pair(made.server);
}

/** Tries connecting this phone again to a server already made. */
export async function retryPairing(): Promise<void> {
  const next = dispatch({ type: "retryPairing" });
  if (next.step === "pairing") await pair(next.server);
}

/** Ends the signup: the server is on this phone's list from here on. */
export function finishHostedSignup(): void {
  dispatch({ type: "finished" });
}

/** Starts over once a finished signup's screen is left. */
export function resetHostedSignup(): void {
  if (appAtomRegistry.get(hostedSignupAtom).step === "done") {
    appAtomRegistry.set(hostedSignupAtom, SIGNUP_IDLE);
  }
}

export type OpenSetupResult = "opened" | "notAllowed" | "failed";

export const SETUP_NOT_ALLOWED =
  "This phone isn't allowed to do that. Open Majordome on your computer to finish setting up.";
export const SETUP_FAILED =
  "The setup page couldn't be opened. Check that Majordome is connected, then try again.";

/**
 * Opens the computer's own welcome page in the browser, signed in with a one-time code. Signing
 * in to the AI and starting the notes happen there: the phone has no screens for them.
 */
export async function openSetupPage(environmentId: string): Promise<OpenSetupResult> {
  const id = EnvironmentId.make(environmentId);
  const address = appAtomRegistry.get(savedConnectionsByIdAtom)[id]?.httpBaseUrl;
  if (address === undefined) return "failed";
  if (!readEnvironmentScope(id, AuthAccessWriteScope)) return "notAllowed";
  const result = await runAtomCommand(
    appAtomRegistry,
    authEnvironment.createPairingCredential,
    {
      environmentId: id,
      input: {
        label: "Web browser",
        scopes: AuthStandardClientScopes.filter((scope) => readEnvironmentScope(id, scope)),
      },
    },
    { reportFailure: false },
  );
  if (!AsyncResult.isSuccess(result)) return "failed";
  const url = setupPageUrl(address, result.value.credential);
  return url !== null && (await tryOpenExternalUrl(url)) ? "opened" : "failed";
}
