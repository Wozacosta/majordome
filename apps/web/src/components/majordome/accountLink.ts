import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomeAccount } from "@t3tools/contracts";
import { ACCOUNT_TOKEN_OPTIONS, withAccountServer } from "@t3tools/shared/majordomeAccount";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { majordomeEnvironment } from "../../state/majordome";

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
 * Adds every server this app is connected to to the account just signed in to, and lists the
 * ones other devices can reach. A server that belongs to another account, that this device may
 * not change, or that is too old for accounts answers with a failure, which is left as it is:
 * the account page shows each server's state and its own button.
 */
export async function addConnectedServersToAccount(
  account: AccountSession,
  servers: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly name: string }>,
): Promise<void> {
  for (const server of servers) {
    // A fresh token each time: one lives a minute, and a slow server could outlast it.
    const token = (await account.session?.getToken(ACCOUNT_TOKEN_OPTIONS)) ?? null;
    if (token === null) return;
    const linked = await runAtomCommand(
      appAtomRegistry,
      majordomeEnvironment.linkAccount,
      { environmentId: server.environmentId, input: { token } },
      { reportFailure: false, reportDefect: false },
    );
    if (linked._tag === "Success") await listAccountServer(account, server, linked.value);
  }
}
