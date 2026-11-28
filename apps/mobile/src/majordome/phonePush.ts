import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type MajordomePhonePushDevice } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { environmentCatalog } from "../connection/catalog";
import { subscribeAppActive } from "../lib/appState";
import { writeFileAtomically } from "../lib/atomic-file";
import { makePermissionStatusAtom } from "../lib/permissionStatusAtom";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentServerConfigsAtom } from "../state/server";
import { workspaceConnections } from "../state/workspace";
import {
  EMPTY_PHONE_PUSH_STORE,
  forgetRemovedPhonePushComputers,
  PHONE_PUSH_WORDS,
  phonePushApnsEnvironment,
  type PhonePushComputer,
  type PhonePushPermission,
  type PhonePushStanding,
  phonePushStanding,
  type PhonePushStore,
  phonePushTestTargets,
  phonePushWork,
} from "./phonePush.logic";
import { majordomeEnvironment } from "./state";

const FILE_NAME = "majordome-phone-push.json";
/** The channel the address service names in what it sends to Android (infra/broker/src/push.ts). */
const ANDROID_CHANNEL = "majordome";
const TOKEN_WAIT_MS = 10_000;
const FORGET_WAIT_MS = 4_000;

/** Null until the phone's copy has been read; nothing is written before that. */
export const phonePushStoreAtom = Atom.make<PhonePushStore | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("majordome:phone-push-store"),
);

/** True once the phone refused to give an address for notifications. */
const phonePushTokenFailedAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("majordome:phone-push-token-failed"),
);

/** False in an Android build made without Google's service file: it can receive nothing. */
export function appCanReceivePhonePush(): boolean {
  return Platform.OS === "ios" || Constants.expoConfig?.extra?.majordomePush?.android === true;
}

// As JSON, so it only changes when a computer connects, leaves or says what it can do.
const computersKeyAtom = Atom.make((get) => {
  const configs = get(environmentServerConfigsAtom);
  return JSON.stringify(
    get(workspaceConnections.environmentsAtom).map((environment): PhonePushComputer => {
      const config = configs.get(environment.environmentId);
      return {
        id: environment.environmentId,
        // Until a computer has said what it can do, it is not asked.
        connected:
          environment.isEnabled &&
          environment.connectionState === "connected" &&
          config !== undefined,
        supported: config?.environment.capabilities.majordomePhonePush === true,
      };
    }),
  );
}).pipe(Atom.withLabel("majordome:phone-push-computers"));

const phonePushComputersAtom = Atom.make(
  (get) => JSON.parse(get(computersKeyAtom)) as ReadonlyArray<PhonePushComputer>,
).pipe(Atom.withLabel("majordome:phone-push-computers-list"));

const readPermission = (): Promise<PhonePushPermission> =>
  Notifications.getPermissionsAsync().then(
    (permission): PhonePushPermission =>
      permission.granted ? "granted" : permission.canAskAgain ? "unknown" : "denied",
    (): PhonePushPermission => "unknown",
  );

const phonePushPermissionAtom = makePermissionStatusAtom<PhonePushPermission>({
  label: "majordome:phone-push-permission",
  initial: "unknown",
  read: readPermission,
});

/** Where notifications stand on this phone, for the page and for Settings' row. */
export function usePhonePushStanding(): PhonePushStanding | null {
  const store = useAtomValue(phonePushStoreAtom);
  const permission = useAtomValue(phonePushPermissionAtom);
  const tokenFailed = useAtomValue(phonePushTokenFailedAtom);
  const computers = useAtomValue(phonePushComputersAtom);
  if (store === null) return null;
  return phonePushStanding({
    store,
    permission,
    appCanReceive: appCanReceivePhonePush(),
    tokenFailed,
    computers,
  });
}

async function storeFile() {
  const { File, Paths } = await import("expo-file-system");
  return new File(Paths.document, FILE_NAME);
}

let writing: Promise<void> = Promise.resolve();

function updateStore(update: (store: PhonePushStore) => PhonePushStore): void {
  const current = appAtomRegistry.get(phonePushStoreAtom);
  if (current === null) return;
  const next = update(current);
  if (next === current) return;
  appAtomRegistry.set(phonePushStoreAtom, next);
  writing = writing
    .then(async () => writeFileAtomically(await storeFile(), JSON.stringify(next)))
    .catch(() => undefined);
}

/** The phone's own address for notifications, or null when it gives none. */
async function readToken(): Promise<string | null> {
  if (!appCanReceivePhonePush()) return null;
  if ((await readPermission()) !== "granted") return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // With no route to Apple or Google the phone never answers, so the wait has an end.
    const token = await Promise.race([
      Notifications.getDevicePushTokenAsync(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TOKEN_WAIT_MS);
      }),
    ]);
    const value =
      token?.type === Platform.OS && typeof token.data === "string" ? token.data.trim() : "";
    appAtomRegistry.set(phonePushTokenFailedAtom, value === "");
    return value === "" ? null : value;
  } catch {
    appAtomRegistry.set(phonePushTokenFailedAtom, true);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function thisPhone(token: string): MajordomePhonePushDevice {
  if (Platform.OS === "android") {
    return { platform: "android", token, label: "Android · Majordome app" };
  }
  return {
    platform: "ios",
    token,
    bundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? "",
    apnsEnvironment: phonePushApnsEnvironment(Constants.expoConfig?.extra?.appVariant),
    label: "iPhone · Majordome app",
  };
}

// The computers told since the app started, with the token they were told.
const told: Record<string, string> = {};

async function forget(environmentId: string, endpoint: string): Promise<boolean> {
  const result = await runAtomCommand(
    appAtomRegistry,
    majordomeEnvironment.removePushSubscription,
    { environmentId: EnvironmentId.make(environmentId), input: { endpoint } },
    { reportFailure: false },
  );
  if (result._tag !== "Success") return false;
  delete told[environmentId];
  updateStore((store) => {
    const { [environmentId]: _gone, ...registered } = store.registered;
    return { ...store, registered };
  });
  return true;
}

async function register(environmentId: string, token: string): Promise<void> {
  const result = await runAtomCommand(
    appAtomRegistry,
    majordomeEnvironment.registerPhonePush,
    { environmentId: EnvironmentId.make(environmentId), input: thisPhone(token) },
    { reportFailure: false },
  );
  if (result._tag !== "Success") return;
  told[environmentId] = token;
  const { endpoint, canSend } = result.value;
  updateStore((store) => ({
    ...store,
    registered: { ...store.registered, [environmentId]: { endpoint, token, canSend } },
  }));
}

let syncing = false;
let syncAgain = false;

/** Brings every reachable computer in line with the switch. Runs one at a time. */
async function sync(): Promise<void> {
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    do {
      syncAgain = false;
      const store = appAtomRegistry.get(phonePushStoreAtom);
      if (store === null) return;
      const token = store.wanted ? await readToken() : null;
      const work = phonePushWork({
        store,
        token,
        computers: appAtomRegistry.get(phonePushComputersAtom),
        told,
      });
      for (const step of work) {
        if (step.type === "forget") await forget(step.environmentId, step.endpoint);
        else if (token !== null) await register(step.environmentId, token);
      }
    } while (syncAgain);
  } finally {
    syncing = false;
  }
}

/**
 * Turns notifications on, asking the phone's permission now. Resolves to what the phone
 * answered; when it refuses, the switch stays off.
 */
export async function turnOnPhonePush(): Promise<PhonePushPermission> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: PHONE_PUSH_WORDS.title,
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => undefined);
  }
  let permission = await readPermission();
  if (permission === "unknown") {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    }).then(
      (asked): PhonePushPermission => (asked.granted ? "granted" : "denied"),
      (): PhonePushPermission => "denied",
    );
  }
  appAtomRegistry.set(phonePushPermissionAtom, permission);
  if (permission !== "granted") return permission;
  updateStore((store) => ({ ...store, wanted: true }));
  await sync();
  return permission;
}

/** Turns notifications off; a computer that cannot be reached now is told when it next can. */
export async function turnOffPhonePush(): Promise<void> {
  updateStore((store) => ({ ...store, wanted: false }));
  await sync();
}

/**
 * Before a computer is removed from this phone: tells it to forget the phone, since afterwards
 * there is no connection to say it over. Never holds the removal up for long.
 */
export async function forgetPhonePushOn(environmentId: string): Promise<void> {
  const endpoint = appAtomRegistry.get(phonePushStoreAtom)?.registered[environmentId]?.endpoint;
  if (endpoint === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    forget(environmentId, endpoint),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FORGET_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}

/** Asks each computer that can reach this phone to send a test. Resolves to what went wrong, if anything. */
export async function sendPhonePushTest(): Promise<string | null> {
  const store = appAtomRegistry.get(phonePushStoreAtom) ?? EMPTY_PHONE_PUSH_STORE;
  const targets = phonePushTestTargets(store, appAtomRegistry.get(phonePushComputersAtom));
  if (targets.length === 0) return PHONE_PUSH_WORDS.testFailed;
  const results = await Promise.all(
    targets.map((target) =>
      runAtomCommand(
        appAtomRegistry,
        majordomeEnvironment.sendTestPush,
        {
          environmentId: EnvironmentId.make(target.environmentId),
          input: { endpoint: target.endpoint },
        },
        { reportFailure: false },
      ),
    ),
  );
  // One computer that sent it is enough: the test is about this phone.
  if (results.some((result) => result._tag === "Success")) return null;
  // A computer that forgot this phone, or lost its way to send, hears about it again.
  for (const target of targets) delete told[target.environmentId];
  void sync();
  return PHONE_PUSH_WORDS.testFailed;
}

let loading: Promise<void> | null = null;

function loadStore(): Promise<void> {
  loading ??= (async () => {
    let stored = EMPTY_PHONE_PUSH_STORE;
    try {
      const file = await storeFile();
      if (file.exists) {
        stored = {
          ...EMPTY_PHONE_PUSH_STORE,
          ...(JSON.parse(await file.text()) as PhonePushStore),
        };
      }
    } catch {
      // An unreadable copy is the same as off: the switch turns it on again.
    }
    appAtomRegistry.set(phonePushStoreAtom, stored);
  })();
  return loading;
}

/**
 * App-lifetime: reads the switch, then tells computers as they connect, when the phone renews
 * its token and each time the app comes back to the front. Asks no permission.
 */
export function installPhonePush(): () => void {
  const stops: Array<() => void> = [];
  let stopped = false;
  void loadStore().then(() => {
    if (stopped) return;
    stops.push(
      appAtomRegistry.subscribe(computersKeyAtom, () => void sync(), { immediate: true }),
      appAtomRegistry.subscribe(
        environmentCatalog.catalogValueAtom,
        (catalog) => {
          // Not before the saved computers are read: until then every computer looks removed.
          if (!catalog.isReady) return;
          updateStore((store) =>
            forgetRemovedPhonePushComputers(store, (environmentId) =>
              catalog.entries.has(EnvironmentId.make(environmentId)),
            ),
          );
        },
        { immediate: true },
      ),
      subscribeAppActive(() => void sync()),
    );
    const tokens = Notifications.addPushTokenListener(() => void sync());
    stops.push(() => tokens.remove());
  });
  return () => {
    stopped = true;
    for (const stop of stops) stop();
  };
}
