import { getClerkInstance } from "@clerk/expo";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthAccessWriteScope,
  AuthStandardClientScopes,
  EnvironmentId,
  MAJORDOME_ACCOUNT_SIGN_IN_PATH,
} from "@t3tools/contracts";
import {
  ACCOUNT_TOKEN_OPTIONS,
  readAccountServers,
  signInToAccountServer,
} from "@t3tools/shared/majordomeAccount";
import { AsyncResult, Atom } from "effect/reactivity";
import { Platform } from "react-native";

import { hasAccountPublicConfig, resolveCloudPublicConfig } from "../features/cloud/publicConfig";
import { buildPairingUrl, parsePairingUrl } from "../features/connection/pairing";
import { writeFileAtomically } from "../lib/atomic-file";
import { majordomeStore } from "../native/majordomeStore";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import { appAtomRegistry } from "../state/atom-registry";
import { authEnvironment } from "../state/auth";
import { readEnvironmentScope } from "../state/session";
import {
  pairEnvironment,
  savedConnectionsByIdAtom,
} from "../state/use-remote-environment-registry";
import {
  accountConnectErrorForOwner,
  connectErrorForOwner,
  MAJORDOME_SERVER,
} from "./connectWording";
import { isMajordome } from "./env";
import { serverOfferAtom } from "./serverOffer";
import {
  alreadyConnected,
  brokerUrl,
  makeHostedServer,
  readSignupProgress,
  setupPageUrl,
  SIGNUP_IDLE,
  signupNext,
  signupPairingUrl,
  signupProgress,
  storedPairingUrl,
  waitUntilReady,
  type HostedServer,
  type SignupEvent,
  type SignupNote,
  type SignupState,
} from "./hostedSignup.logic";
import {
  alreadyConnectedNote,
  awaitingApprovalNote,
  buyDecision,
  confirmApplePurchase,
  isFirstPurchase,
  nothingToRestoreNote,
  paidTransaction,
  payingOffered,
  purchaseFailure,
  readBillingStatus,
  serverOffer,
  serverProductId,
  signedOutNote,
  storeFailedNote,
  type StorePurchase,
} from "./serverPurchase.logic";

// Spelled out in full: Expo only inlines `process.env.EXPO_PUBLIC_*` written this way.
export const BROKER_URL = brokerUrl(process.env.EXPO_PUBLIC_MAJORDOME_BROKER_URL);
const PRODUCT_ID = serverProductId(process.env.EXPO_PUBLIC_MAJORDOME_SERVER_PRODUCT_ID);
/** Servers are sold through Apple only, to a Majordome account. */
const SOLD_HERE =
  isMajordome && Platform.OS === "ios" && majordomeStore !== null && hasAccountPublicConfig();
const FILE_NAME = "majordome-hosted-signup.json";
// The link makes its holder the server's owner, so it stays out of the file, which backups copy.
const PAIRING_URL_KEY = "majordome.hosted-signup.pairing-url";

async function keepPairingUrl(pairingUrl: string | null): Promise<void> {
  const SecureStore = await import("expo-secure-store");
  const deviceOnly = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  if (pairingUrl === null) await SecureStore.deleteItemAsync(PAIRING_URL_KEY, deviceOnly);
  else await SecureStore.setItemAsync(PAIRING_URL_KEY, pairingUrl, deviceOnly);
}

async function keptPairingUrl(): Promise<string | null> {
  try {
    const SecureStore = await import("expo-secure-store");
    return await SecureStore.getItemAsync(PAIRING_URL_KEY, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    return null;
  }
}

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
  const pairingUrl = signupPairingUrl(next);
  if (pairingUrl !== signupPairingUrl(before)) {
    writing = writing.then(() => keepPairingUrl(pairingUrl)).catch(() => undefined);
  }
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
    // A file from an earlier version holds the link: resuming writes both again, each in its place.
    const pairingUrl = storedPairingUrl(stored) ?? (await keptPairingUrl());
    const next = dispatch({ type: "resumed", progress: readSignupProgress(stored), pairingUrl });
    if (pairingUrl !== null && signupPairingUrl(next) === null) {
      writing = writing.then(() => keepPairingUrl(null)).catch(() => undefined);
    }
  })();
  return loading;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

// The same account the screens sign in to, reached here so a purchase carries on without one open.
const { publishableKey } = resolveCloudPublicConfig().clerk;
// No token cache named: naming one replaces the provider's, which is what keeps this account
// and the native sign-in form on one session.
const account = () => (publishableKey === null ? null : getClerkInstance({ publishableKey }));

async function accountToken(): Promise<string | null> {
  try {
    return (await account()?.session?.getToken(ACCOUNT_TOKEN_OPTIONS)) ?? null;
  } catch {
    return null;
  }
}

const SERVER_NAME = "Your server";

/** A one-time code for a server the account owns, as a link, or why there is none. */
async function accountPairingUrl(
  server: HostedServer,
): Promise<{ readonly url: string } | { readonly problem: string }> {
  const token = await accountToken();
  if (token === null) return { problem: MAJORDOME_SERVER.signInToConnect };
  const listed = readAccountServers(account()?.user?.unsafeMetadata).find((entry) =>
    alreadyConnected(server.url, [entry.url]),
  );
  const signedIn = await signInToAccountServer({
    // The server's own sign-in key, when the account lists it; a server not listed asks for none.
    server: { environmentId: "", url: server.url, ...listed, name: SERVER_NAME },
    token,
    path: MAJORDOME_ACCOUNT_SIGN_IN_PATH,
    request: (url, init) => fetch(url, init),
  });
  return signedIn.ok
    ? { url: buildPairingUrl(server.url, signedIn.credential) }
    : { problem: signedIn.message };
}

async function pair(server: HostedServer): Promise<void> {
  const fresh = server.pairingUrl !== null;
  let pairingUrl: string;
  if (server.pairingUrl !== null) {
    // The same spelling a scanned code is connected with.
    const { host, code } = parsePairingUrl(server.pairingUrl);
    pairingUrl = buildPairingUrl(host, code);
  } else {
    const made = await accountPairingUrl(server);
    if ("problem" in made) {
      dispatch({ type: "pairingFailed", message: made.problem });
      return;
    }
    pairingUrl = made.url;
  }
  const outcome = await pairEnvironment(pairingUrl);
  if (outcome.ok && outcome.environmentId !== undefined) {
    dispatch({ type: "paired", environmentId: outcome.environmentId, fresh });
    return;
  }
  const message =
    outcome.error === null
      ? "This phone couldn't connect to your server."
      : fresh
        ? connectErrorForOwner(outcome.error)
        : accountConnectErrorForOwner(outcome.error, SERVER_NAME);
  dispatch({ type: "pairingFailed", message });
}

const state = () => appAtomRegistry.get(hostedSignupAtom);
const stop = (note: SignupNote | null) => void dispatch({ type: "stopped", note });

/**
 * The paid account's server, made if it is not yet, then this phone connected to it. `already`
 * is what to say when this phone is connected to it already.
 */
async function makeAndConnect(token: string, already: SignupNote | null): Promise<void> {
  const { step } = state();
  if (step !== "idle" && step !== "paying") return;
  dispatch({ type: "submit" });
  const made = await makeHostedServer(fetch, BROKER_URL, token);
  if (!made.ok) return stop({ kind: "error", message: made.message });
  const connections = Object.values(appAtomRegistry.get(savedConnectionsByIdAtom));
  if (
    made.server.pairingUrl === null &&
    alreadyConnected(
      made.server.url,
      connections.map((connection) => connection.httpBaseUrl),
    )
  ) {
    return stop(already);
  }
  dispatch({ type: "made", server: made.server });
  await waitUntilReady(fetch, BROKER_URL, made.server.name, wait);
  dispatch({ type: "ready" });
  await pair(made.server);
}

const settling = new Map<string, Promise<void>>();

/**
 * Takes one purchase of the server to its end. The App Store hands a purchase over again at
 * every launch until it is marked delivered, which happens only once the service confirms it.
 */
function settle(purchase: StorePurchase): Promise<void> {
  const transactionId = paidTransaction(purchase, PRODUCT_ID);
  if (transactionId === null) return Promise.resolve();
  const running = settling.get(transactionId);
  if (running !== undefined) return running;
  const run = (async () => {
    const token = await accountToken();
    // Nobody to give it to: it comes back at the next launch, or once someone signs in.
    if (token === null) return state().step === "paying" ? stop(signedOutNote) : undefined;
    const asked = state().step === "paying";
    if (asked) dispatch({ type: "pay", doing: "confirming" });
    const refusal = await confirmApplePurchase(fetch, BROKER_URL, token, transactionId);
    if (refusal !== null) return asked ? stop(refusal) : undefined;
    await majordomeStore?.finish(transactionId).catch(() => undefined);
    if (asked) await makeAndConnect(token, alreadyConnectedNote);
    else if (isFirstPurchase(purchase)) await makeAndConnect(token, null);
  })().finally(() => settling.delete(transactionId));
  settling.set(transactionId, run);
  return run;
}

async function settleUnfinished(): Promise<void> {
  const unfinished = (await majordomeStore?.unfinished().catch(() => [])) ?? [];
  for (const purchase of unfinished) await settle(purchase);
}

/**
 * Listens for purchases from the first moment: one bought earlier and not yet delivered arrives
 * at launch. Does nothing where servers are not sold.
 */
export function installServerPurchases(): () => void {
  const store = majordomeStore;
  if (!SOLD_HERE || store === null) return () => undefined;
  let signedInAs: string | null = null;
  const stopWatchingAccount = account()?.addListener(({ session }) => {
    const id = session?.id ?? null;
    if (id === signedInAs) return;
    signedInAs = id;
    if (id !== null) void settleUnfinished();
  });
  const listening = store.addListener("purchase", (purchase) => void settle(purchase));
  void settleUnfinished();
  void (async () => {
    try {
      const [offered, product] = await Promise.all([
        payingOffered(fetch, BROKER_URL),
        store.product(PRODUCT_ID),
      ]);
      if (!offered || product === null) return;
      appAtomRegistry.set(serverOfferAtom, serverOffer(product, product.trialOpen));
    } catch {
      // No store to buy from: the app says what it said before servers were sold.
    }
  })();
  return () => {
    stopWatchingAccount?.();
    listening.remove();
  };
}

/** Opens Apple's sheet for the signed-in account, unless it has a server or none can be made. */
export async function buyServer(): Promise<void> {
  // Only the first of two presses gets past here: the state changes before anything is awaited.
  if (state().step !== "idle") return;
  dispatch({ type: "pay", doing: "checking" });
  const token = await accountToken();
  if (token === null) return stop(signedOutNote);
  const decision = buyDecision(await readBillingStatus(fetch, BROKER_URL, token));
  if (!decision.buy) return stop(decision.note);
  dispatch({ type: "pay", doing: "buying" });
  let bought: StorePurchase;
  try {
    const answer = await majordomeStore?.buy(PRODUCT_ID, decision.appToken);
    if (answer === undefined || answer.outcome === "cancelled") return stop(null);
    if (answer.outcome !== "purchased") return stop(awaitingApprovalNote);
    bought = answer.purchase;
  } catch (cause) {
    return stop(purchaseFailure(cause));
  }
  // The listener may have the same purchase: whichever comes first carries it, the other waits.
  await settle(bought);
  if (state().step === "paying") stop(storeFailedNote);
}

/** Finds a server subscription this Apple account already pays for and connects to its server. */
export async function restoreServer(): Promise<void> {
  if (state().step !== "idle") return;
  dispatch({ type: "pay", doing: "restoring" });
  let owned: ReadonlyArray<StorePurchase>;
  try {
    owned = (await majordomeStore?.owned(true)) ?? [];
  } catch (cause) {
    return stop(purchaseFailure(cause));
  }
  const purchase = owned.find((candidate) => paidTransaction(candidate, PRODUCT_ID) !== null);
  if (purchase === undefined) return stop(nothingToRestoreNote);
  await settle(purchase);
}

/** Connects this phone to the server the account already has. */
export async function connectToServer(): Promise<void> {
  if (state().step !== "idle") return;
  dispatch({ type: "pay", doing: "checking" });
  const token = await accountToken();
  if (token === null) return stop(signedOutNote);
  await makeAndConnect(token, alreadyConnectedNote);
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

/** Starts over once the screen is left with nothing under way. */
export function resetHostedSignup(): void {
  const { step } = appAtomRegistry.get(hostedSignupAtom);
  if (step === "done" || step === "idle") appAtomRegistry.set(hostedSignupAtom, SIGNUP_IDLE);
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
