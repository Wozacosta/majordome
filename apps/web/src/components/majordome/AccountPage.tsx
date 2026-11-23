import { useAuth, useClerk, useUser } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MAJORDOME_ACCOUNT_SIGN_IN_PATH,
  type MajordomeAccount,
} from "@t3tools/contracts";
import {
  ACCOUNT_TOKEN_OPTIONS,
  type AccountServer,
  readAccountServers,
  signInToAccountServer,
  withoutAccountServer,
} from "@t3tools/shared/majordomeAccount";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef, useState } from "react";

import { hasAccountPublicConfig } from "../../cloud/publicConfig";
import { environmentCatalog } from "../../connection/catalog";
import { connectPairing } from "../../connection/onboarding";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveDesktopPairingUrl } from "../settings/pairingUrls";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { listAccountServer } from "./accountLink";
import { MajordomeSettingsPage } from "./MajordomeSettingsPage";
import { Entry, EntryList, Muted, Section, StatusLine } from "./paper";
import { useMachineNames } from "./useMachineNames";

const SIGN_IN_AGAIN = "Sign in again, then try once more.";
const ADDRESS_FAILED = "This computer could not get an address.";

const failureMessage = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

export function AccountPage() {
  return (
    <MajordomeSettingsPage
      searchId="majordome-account"
      outline={false}
      intro="Sign in on a new phone or computer and it finds your servers by itself. Optional: pairing with a code keeps working."
    >
      {hasAccountPublicConfig() ? (
        <SignedInOrOut />
      ) : (
        <Muted className="mt-6">This version of Majordome has no accounts.</Muted>
      )}
    </MajordomeSettingsPage>
  );
}

function SignedInOrOut() {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();
  const { primaryEnvironmentId } = useMachineNames();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentIds = [
    ...(primaryEnvironmentId === null ? [] : [primaryEnvironmentId]),
    ...Array.from(catalog.entries.keys()).filter((id) => id !== primaryEnvironmentId),
  ];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the sign-in window belongs to the account service, which leaves it open after a sign-in that returns from the browser
  useEffect(() => {
    if (isSignedIn) clerk.closeSignIn();
  }, [isSignedIn, clerk]);

  if (!isLoaded) return <Muted className="mt-6">Checking your account…</Muted>;

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  return (
    <>
      <Section label="Account">
        {isSignedIn ? (
          <Entry
            as="div"
            title={email ?? "Signed in"}
            actions={
              <Button variant="outline" size="sm" onClick={() => void clerk.signOut()}>
                Sign out
              </Button>
            }
          />
        ) : (
          <Entry
            as="div"
            title="Not signed in"
            actions={
              <Button size="sm" onClick={() => clerk.openSignIn()}>
                Sign in
              </Button>
            }
          />
        )}
      </Section>
      {/* Every connected server, this computer first: an always-on server is the one a phone
          can reach, and it can only be added from a device already connected to it. */}
      {environmentIds.map((environmentId) => (
        <ThisServer
          key={environmentId}
          environmentId={environmentId}
          signedIn={isSignedIn === true}
        />
      ))}
      {isSignedIn ? <AccountServers /> : null}
    </>
  );
}

/** Reads a fresh token for the signed-in account, or null when the session has ended. */
function useAccountToken() {
  const clerk = useClerk();
  return async () => (await clerk.session?.getToken(ACCOUNT_TOKEN_OPTIONS)) ?? null;
}

function ThisServer(props: { readonly environmentId: EnvironmentId; readonly signedIn: boolean }) {
  const result = useAtomValue(
    majordomeEnvironment.account({ environmentId: props.environmentId, input: {} }),
  );
  const account = AsyncResult.getOrElse(result, () => null);
  // A server too old for accounts, or one with no account service, has nothing to show.
  if (account === null || !account.available) return null;
  return <ServerAccount {...props} account={account} />;
}

function ServerAccount({
  environmentId,
  signedIn,
  account,
}: {
  readonly environmentId: EnvironmentId;
  readonly signedIn: boolean;
  readonly account: MajordomeAccount;
}) {
  const { user } = useUser();
  const { machineOf } = useMachineNames();
  const readToken = useAccountToken();
  const canChange = useAtomValue(majordomeEnvironment.linkAccount.permissionAtom(environmentId));
  const link = useAtomCommand(majordomeEnvironment.linkAccount, { reportFailure: false });
  const unlink = useAtomCommand(majordomeEnvironment.unlinkAccount, { reportFailure: false });
  const canOpenAddress = useAtomValue(
    majordomeEnvironment.enableAnywhereAddress.permissionAtom(environmentId),
  );
  const enableAddress = useAtomCommand(majordomeEnvironment.enableAnywhereAddress, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One listing at a time: the account service is slower than a render.
  const listing = useRef(false);

  const name = machineOf(environmentId);
  const mine = account.owner !== null && account.owner.accountId === user?.id;

  const run = async (change: "link" | "unlink") => {
    setBusy(true);
    setError(null);
    const answer = await changeAccount(change);
    setBusy(false);
    if (answer !== null) setError(answer);
  };

  const changeAccount = async (change: "link" | "unlink"): Promise<string | null> => {
    if (change === "unlink") {
      const removed = await unlink({ environmentId, input: {} });
      if (removed._tag !== "Success") {
        return isAtomCommandInterrupted(removed)
          ? null
          : failureMessage(squashAtomCommandFailure(removed));
      }
      await user?.update({
        unsafeMetadata: withoutAccountServer(user.unsafeMetadata, environmentId),
      });
      return null;
    }
    const token = await readToken();
    if (token === null) return SIGN_IN_AGAIN;
    const linked = await link({ environmentId, input: { token } });
    if (linked._tag !== "Success") {
      return isAtomCommandInterrupted(linked)
        ? null
        : failureMessage(squashAtomCommandFailure(linked));
    }
    await listServer(linked.value);
    return null;
  };

  const listServer = (linked: MajordomeAccount) =>
    listAccountServer({ user }, { environmentId, name }, linked);

  const listed = readAccountServers(user?.unsafeMetadata).some(
    (server) => server.environmentId === environmentId && server.url === account.address,
  );

  const needsListing = mine && account.address !== null && !listed;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the list lives in the account service: a server that got its address after it was added is listed there as soon as this page sees it
  useEffect(() => {
    if (!needsListing || listing.current) return;
    listing.current = true;
    void listAccountServer({ user }, { environmentId, name }, account).finally(() => {
      listing.current = false;
    });
  }, [needsListing, user, environmentId, name, account]);

  // Opens the public address, then reads the account again so the new address is listed.
  const giveAddress = async (): Promise<string | null> => {
    const opened = await enableAddress({ environmentId, input: {} });
    if (opened._tag !== "Success") {
      return isAtomCommandInterrupted(opened)
        ? null
        : failureMessage(squashAtomCommandFailure(opened));
    }
    const { anywhere } = opened.value;
    if (anywhere.state === "unavailable") return anywhere.reason ?? ADDRESS_FAILED;
    const token = await readToken();
    if (token === null) return SIGN_IN_AGAIN;
    const linked = await link({ environmentId, input: { token } });
    if (linked._tag === "Success") await listServer(linked.value);
    return null;
  };
  const runGiveAddress = async () => {
    setBusy(true);
    setError(null);
    const answer = await giveAddress();
    setBusy(false);
    if (answer !== null) setError(answer);
  };

  return (
    <Section label={name}>
      {account.owner === null ? (
        <Entry
          as="div"
          title="Not in an account"
          meta="Add it, and signing in on another device connects that device here."
          actions={
            signedIn && canChange ? (
              <Button size="sm" disabled={busy} onClick={() => void run("link")}>
                Add to my account
              </Button>
            ) : null
          }
        />
      ) : (
        <Entry
          as="div"
          title={account.owner.email ?? "In an account"}
          aside={mine ? <Badge variant="secondary">Your account</Badge> : null}
          meta={
            account.fixed
              ? "Set when this server was made. It cannot be removed."
              : !signedIn || mine
                ? null
                : "This is another account than the one you are signed in to."
          }
          actions={
            account.fixed || !canChange ? null : (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run("unlink")}
              >
                Remove from account
              </Button>
            )
          }
        />
      )}
      {mine && account.address === null ? (
        <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
          <StatusLine tone="warning" className="min-w-0 flex-1 basis-60">
            Your phone cannot reach {name} yet. It needs an address on the internet, which only
            devices signed in to your account or paired with a code can open.
          </StatusLine>
          {canOpenAddress ? (
            <Button size="sm" disabled={busy} onClick={() => void runGiveAddress()}>
              {busy ? "Getting an address…" : "Give it an address"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error === null ? null : <p className="mt-3 text-sm text-destructive-foreground">{error}</p>}
    </Section>
  );
}

function AccountServers() {
  const { user } = useUser();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const connected = new Set<string>(catalog.entries.keys());
  const servers = readAccountServers(user?.unsafeMetadata);

  return (
    <Section label="Your servers">
      {servers.length === 0 ? (
        <Muted>No server is in your account yet.</Muted>
      ) : (
        <EntryList>
          {servers.map((server) => (
            <AccountServerRow
              key={server.environmentId}
              server={server}
              connected={connected.has(server.environmentId)}
            />
          ))}
        </EntryList>
      )}
    </Section>
  );
}

function AccountServerRow({
  server,
  connected,
}: {
  readonly server: AccountServer;
  readonly connected: boolean;
}) {
  const readToken = useAccountToken();
  const connect = useAtomCommand(connectPairing, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (): Promise<string | null> => {
    const token = await readToken();
    if (token === null) return SIGN_IN_AGAIN;
    const signedIn = await signInToAccountServer({
      server,
      token,
      path: MAJORDOME_ACCOUNT_SIGN_IN_PATH,
      request: (url, init) => fetch(url, init),
    });
    if (!signedIn.ok) return signedIn.message;
    const paired = await connect({
      pairingUrl: resolveDesktopPairingUrl(server.url, signedIn.credential),
    });
    if (paired._tag === "Success" || isAtomCommandInterrupted(paired)) return null;
    return failureMessage(squashAtomCommandFailure(paired));
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    const answer = await signIn();
    setBusy(false);
    if (answer !== null) setError(answer);
  };

  return (
    <Entry
      title={server.name}
      meta={new URL(server.url).host}
      aside={connected ? <Badge variant="secondary">Connected</Badge> : null}
      actions={
        connected ? null : (
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            Connect
          </Button>
        )
      }
    >
      {error === null ? null : <p className="text-sm text-destructive-foreground">{error}</p>}
    </Entry>
  );
}
