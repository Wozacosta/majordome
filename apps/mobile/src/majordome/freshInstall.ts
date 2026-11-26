import { getClerkInstance } from "@clerk/expo";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";

import { CONNECTION_CATALOG_KEY, LEGACY_CONNECTIONS_KEY } from "../connection/catalog-store";
import { resolveCloudPublicConfig } from "../features/cloud/publicConfig";
import { isFreshInstall } from "./freshInstall.logic";

function detect(): boolean {
  try {
    const mark = new File(Paths.document, "majordome-installed");
    const fresh = isFreshInstall({
      mark: mark.exists,
      database: new File(Paths.document, "SQLite", "t3code-client.db").exists,
    });
    if (!mark.exists) mark.create();
    return fresh;
  } catch {
    // Unknown is not fresh: a wrong yes would disconnect a phone in use.
    return false;
  }
}

// Read once, as the app loads: the database appears moments later.
const fresh = detect();

/**
 * Forgets the computers a deleted copy of the app left in the keychain, so a new install opens
 * on the welcome and not on a computer it may no longer reach. Resolves before they are read.
 */
export const leftoverComputersCleared: Promise<void> = fresh
  ? Promise.allSettled([
      SecureStore.deleteItemAsync(CONNECTION_CATALOG_KEY),
      SecureStore.deleteItemAsync(LEGACY_CONNECTIONS_KEY),
    ]).then(() => undefined)
  : Promise.resolve();

/** Signs out the account a deleted copy of the app left signed in. */
export function installFreshStart(): () => void {
  const { publishableKey } = resolveCloudPublicConfig().clerk;
  if (!fresh || publishableKey === null) return () => undefined;
  const account = getClerkInstance({ publishableKey });
  // The first word from the account service says who the keychain still holds. Undefined is
  // no word yet, and the listener may be called before addListener has returned.
  let heard = false;
  const stop = account.addListener(({ session }) => {
    if (heard || session === undefined) return;
    heard = true;
    if (session !== null) void account.signOut();
  });
  return stop;
}
