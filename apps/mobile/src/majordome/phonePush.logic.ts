/**
 * Notifications on this phone: what the owner chose, which computers were told, and what the page
 * says. A computer is told once it is connected; turning notifications off tells each one the
 * next time it can be reached.
 */

/** What a computer answered when it was told about this phone. */
export interface PhonePushRegistration {
  /** The name the computer gave this phone, for removing and testing it. */
  readonly endpoint: string;
  /** The token it was told, so a renewed one is sent again. */
  readonly token: string;
  /** False while that computer has no way to reach Apple's or Google's service. */
  readonly canSend: boolean;
}

export interface PhonePushStore {
  /** The switch: the owner wants notifications on this phone. */
  readonly wanted: boolean;
  readonly registered: Readonly<Record<string, PhonePushRegistration>>;
}

export const EMPTY_PHONE_PUSH_STORE: PhonePushStore = { wanted: false, registered: {} };

export interface PhonePushComputer {
  readonly id: string;
  readonly connected: boolean;
  /** False for a computer whose Majordome is from before phone notifications. */
  readonly supported: boolean;
}

export type PhonePushWork =
  | { readonly type: "register"; readonly environmentId: string }
  | { readonly type: "forget"; readonly environmentId: string; readonly endpoint: string };

/**
 * What to tell which computer now. With notifications on, every connected computer hears the
 * phone's token once per launch (it may have been renewed, and the computer may only now be able
 * to send). With them off, every computer that still knows this phone is told to forget it.
 */
export function phonePushWork(input: {
  readonly store: PhonePushStore;
  /** Null while the phone has given none: nothing can be registered. */
  readonly token: string | null;
  readonly computers: ReadonlyArray<PhonePushComputer>;
  /** Computers told since the app started, with the token they were told. */
  readonly told: Readonly<Record<string, string>>;
}): ReadonlyArray<PhonePushWork> {
  const reachable = input.computers.filter((computer) => computer.connected && computer.supported);
  if (!input.store.wanted) {
    return reachable.flatMap((computer): PhonePushWork[] => {
      const known = input.store.registered[computer.id];
      return known === undefined
        ? []
        : [{ type: "forget", environmentId: computer.id, endpoint: known.endpoint }];
    });
  }
  const { token } = input;
  if (token === null) return [];
  return reachable
    .filter((computer) => input.told[computer.id] !== token)
    .map((computer) => ({ type: "register", environmentId: computer.id }));
}

/** Drops what is kept about computers no longer on this phone. */
export function forgetRemovedPhonePushComputers(
  store: PhonePushStore,
  has: (environmentId: string) => boolean,
): PhonePushStore {
  const kept = Object.entries(store.registered).filter(([environmentId]) => has(environmentId));
  return kept.length === Object.keys(store.registered).length
    ? store
    : { ...store, registered: Object.fromEntries(kept) };
}

export type PhonePushPermission = "granted" | "denied" | "unknown";

/**
 * `denied`: the phone's own Settings refuse. `cant`: wanted and allowed, but nothing can send
 * (a build without Google's service, no address from the phone, or every computer too old or
 * with no way to send).
 */
export type PhonePushStanding = "on" | "off" | "denied" | "cant";

export function phonePushStanding(input: {
  readonly store: PhonePushStore;
  readonly permission: PhonePushPermission;
  /** False in a build that cannot receive any (Android without Google's service file). */
  readonly appCanReceive: boolean;
  /** True once the phone refused to give an address for notifications. */
  readonly tokenFailed: boolean;
  readonly computers: ReadonlyArray<PhonePushComputer>;
}): PhonePushStanding {
  if (!input.appCanReceive) return "cant";
  if (!input.store.wanted) return "off";
  if (input.permission === "denied") return "denied";
  if (input.tokenFailed) return "cant";
  // What each computer is known to do: nothing is known of one never reached since turning on.
  const known = input.computers.flatMap((computer): boolean[] => {
    if (computer.connected && !computer.supported) return [false];
    const registration = input.store.registered[computer.id];
    return registration === undefined ? [] : [registration.canSend];
  });
  return known.length > 0 && !known.includes(true) ? "cant" : "on";
}

export const PHONE_PUSH_WORDS = {
  title: "Notifications",
  switch: "Notifications on this phone",
  test: "Send a test",
  openSettings: "Open Settings",
  testFailed: "The test couldn't be sent.",
  standing: {
    on: "On",
    off: "Off",
    denied: "Allow them in the phone's Settings",
    cant: "Your computer can't send them yet",
  } satisfies Record<PhonePushStanding, string>,
} as const;

/** The Settings row says On only when notifications can arrive. */
export function phonePushRowValue(standing: PhonePushStanding): string {
  return standing === "on" ? PHONE_PUSH_WORDS.standing.on : PHONE_PUSH_WORDS.standing.off;
}

/** The computers "Send a test" asks: connected ones that know this phone and can reach it. */
export function phonePushTestTargets(
  store: PhonePushStore,
  computers: ReadonlyArray<PhonePushComputer>,
): ReadonlyArray<{ readonly environmentId: string; readonly endpoint: string }> {
  return computers.flatMap((computer) => {
    const registration = store.registered[computer.id];
    return computer.connected && registration?.canSend === true
      ? [{ environmentId: computer.id, endpoint: registration.endpoint }]
      : [];
  });
}

/** Which of Apple's two services a build's token belongs to: development builds use the sandbox. */
export function phonePushApnsEnvironment(appVariant: unknown): "sandbox" | "production" {
  return appVariant === "development" ? "sandbox" : "production";
}
