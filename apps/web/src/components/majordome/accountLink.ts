import { useAuth, useClerk } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomeAccount } from "@t3tools/contracts";
import { ACCOUNT_TOKEN_OPTIONS, withAccountServer } from "@t3tools/shared/majordomeAccount";
import { useEffect, useEffectEvent } from "react";

import { environmentCatalog } from "../../connection/catalog";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { majordomeEnvironment } from "../../state/majordome";
import { addServersAfterSignIn } from "./accountLink.logic";
import { useMachineNames } from "./useMachineNames";

/** What this file needs of the account service's session and user. */
export interface AccountSession {
  readonly session?:
    | {
        readonly getToken: (options: typeof ACCOUNT_TOKEN_OPTIONS) => Promise<string | null>;
      }
    | null
    | undefined;
  readonly user?:
    | {
        readonly unsafeMetadata: unknown;
        readonly update: (input: { unsafeMetadata: Record<string, unknown> }) => Promise<unknown>;
      }
    | null
    | undefined;
}

/** Lists `linked` in the account once other devices have an address to reach it at. */
export async function listAccountServer(
  account: AccountSession,
  server: { readonly environmentId: EnvironmentId; readonly name: string },
  linked: MajordomeAccount,
): Promise<void> {
  const { user } = account;
  if (linked.address === null || user == null) return;
  await user.update({
    unsafeMetadata: withAccountServer(user.unsafeMetadata, {
      environmentId: server.environmentId,
      url: linked.address,
      name: server.name,
    }),
  });
}

/**
 * Adds every connected server to the account just signed in to, and lists the ones other devices
 * can reach. A server that refuses is left as it is: the account page shows its state and its
 * own button. Answers false when the account gave no token, so no server was asked.
 */
async function addConnectedServersToAccount(
  account: AccountSession,
  servers: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly name: string }>,
): Promise<boolean> {
  for (const server of servers) {
    for (let attempt = 0; attempt < LINK_ATTEMPTS; attempt += 1) {
      // A fresh token each time: one lives a minute, and a slow server could outlast it.
      const token = (await account.session?.getToken(ACCOUNT_TOKEN_OPTIONS)) ?? null;
      if (token === null) return false;
      const linked = await runAtomCommand(
        appAtomRegistry,
        majordomeEnvironment.linkAccount,
        { environmentId: server.environmentId, input: { token } },
        { reportFailure: false, reportDefect: false },
      );
      if (linked._tag === "Success") {
        await listAccountServer(account, server, linked.value);
        break;
      }
      // A server that answered no has decided; one that did not answer may still be connecting,
      // as every server is right after the window reloads from a sign-in in the browser.
      if (isAccountRefusal(squashAtomCommandFailure(linked))) break;
      await new Promise((resolve) => setTimeout(resolve, LINK_RETRY_MS));
    }
  }
  return true;
}

const LINK_ATTEMPTS = 4;
const LINK_RETRY_MS = 4_000;

const isAccountRefusal = (failure: unknown) =>
  typeof failure === "object" &&
  failure !== null &&
  Reflect.get(failure, "_tag") === "MajordomeAccountError";

/** Kept in storage, not in memory: a sign-in through the browser can reload the window. */
const SIGN_IN_ASKED_KEY = "majordome:account-sign-in-asked";

/** Call when the owner presses "Sign in": the sign-in that follows adds the connected servers. */
export function markSignInAsked(): void {
  try {
    localStorage.setItem(SIGN_IN_ASKED_KEY, String(Date.now()));
  } catch {
    // Without storage the servers are added by hand, on the account page.
  }
}

function readSignInAsked(): number | null {
  try {
    const askedAt = Number(localStorage.getItem(SIGN_IN_ASKED_KEY) ?? Number.NaN);
    return Number.isFinite(askedAt) ? askedAt : null;
  } catch {
    return null;
  }
}

function clearSignInAsked(): void {
  try {
    localStorage.removeItem(SIGN_IN_ASKED_KEY);
  } catch {
    // Nothing was stored.
  }
}

/** One run at a time across the places that mount the hook below. */
let adding = false;

/**
 * Adds the connected servers to the account once, after a sign-in asked for with
 * `markSignInAsked`. Safe to mount in several places: the first to see the sign-in takes it.
 */
export function useAddServersAfterSignIn(onAdding?: () => void): void {
  const { isSignedIn } = useAuth();
  const clerk = useClerk();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const { machineOf } = useMachineNames();
  const signedIn = isSignedIn === true;
  const catalogReady = catalog.isReady;

  const add = useEffectEvent(() => {
    if (adding) return;
    adding = true;
    onAdding?.();
    // The mark is kept when the account gave no token, so the next start of the app tries again.
    void addConnectedServersToAccount(
      clerk,
      Array.from(catalog.entries.keys(), (environmentId) => ({
        environmentId,
        name: machineOf(environmentId),
      })),
    )
      .then((asked) => {
        if (asked) clearSignInAsked();
      })
      .catch(() => undefined)
      .finally(() => {
        adding = false;
      });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the account service reports a finished sign-in only through its own store, and the servers are added once when it does
  useEffect(() => {
    const askedAt = readSignInAsked();
    if (addServersAfterSignIn({ askedAt, now: Date.now(), signedIn, catalogReady }) === "add") {
      add();
    }
  }, [signedIn, catalogReady]);
}
