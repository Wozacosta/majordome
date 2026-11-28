import { useClerk, useUser } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import { readAccountServers } from "@t3tools/shared/majordomeAccount";
import {
  isUnknownAccount,
  NEW_TEST_ACCOUNT,
  newTestEmail,
  testAccounts,
  TEST_CODE,
  TEST_PASSWORD,
} from "@t3tools/shared/majordomeTesting";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { hasAccountPublicConfig, resolveCloudPublicConfig } from "../../cloud/publicConfig";
import { environmentCatalog } from "../../connection/catalog";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Entry, PageHeader, Section } from "./paper";
import { useMachineNames } from "./useMachineNames";

type Account = ReturnType<typeof useClerk>;

/** Not in Settings' list: opened by holding the version on About, for trying the app as someone new. */
export function TestingPage() {
  return hasAccountPublicConfig() ? <WithAccount /> : <Testing account={null} servers={null} />;
}

function WithAccount() {
  const account = useClerk();
  const { user } = useUser();
  const listed = readAccountServers(user?.unsafeMetadata).length;
  return (
    <Testing
      account={account}
      servers={
        user == null || listed === 0
          ? null
          : {
              count: listed,
              // The whole list, not one entry: a server deleted elsewhere cannot be asked to leave it.
              forget: async () => {
                await user.update({
                  unsafeMetadata: { ...user.unsafeMetadata, majordomeServers: [] },
                });
              },
            }
      }
    />
  );
}

async function signInAs(account: Account, email: string): Promise<void> {
  const service = account.client;
  if (service === undefined) throw new Error("The account service is not ready yet.");
  const session = await service.signIn
    .create({ strategy: "email_code", identifier: email })
    .then((started) => started.attemptFirstFactor({ strategy: "email_code", code: TEST_CODE }))
    .then(
      (done) => done.createdSessionId,
      async (failure: unknown) => {
        if (!isUnknownAccount(failure)) throw failure;
        const started = await service.signUp.create({
          emailAddress: email,
          password: TEST_PASSWORD,
        });
        await started.prepareEmailAddressVerification({ strategy: "email_code" });
        const done = await started.attemptEmailAddressVerification({ code: TEST_CODE });
        if (done.createdSessionId === null) {
          throw new Error(
            `The account was not made: ${done.status}, missing ${done.missingFields.join(", ")}.`,
          );
        }
        return done.createdSessionId;
      },
    );
  if (session === null) throw new Error("The account service did not sign this account in.");
  await account.setActive({ session });
}

function Testing({
  account,
  servers,
}: {
  readonly account: Account | null;
  readonly servers: { readonly count: number; readonly forget: () => Promise<void> } | null;
}) {
  const navigate = useNavigate();
  const { primaryEnvironmentId } = useMachineNames();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const remove = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const [doing, setDoing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const accounts =
    account === null ? [] : testAccounts(resolveCloudPublicConfig().clerkPublishableKey ?? null);
  const newOwnerCopy = window.desktopBridge?.testing;

  const startOver = async () => {
    await Promise.allSettled(
      Array.from(catalog.entries.keys())
        .filter((id) => id !== primaryEnvironmentId)
        .map((id) => remove(id)),
    );
    await account?.signOut();
  };

  const run = async (label: string, work: () => Promise<void>, leave: boolean) => {
    setDoing(label);
    setProblem(null);
    try {
      await work();
      if (leave) await navigate({ to: "/" });
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
    }
    setDoing(null);
  };

  const action = (
    label: string,
    doingLabel: string,
    work: () => Promise<void>,
    options: { readonly leave?: boolean; readonly primary?: boolean } = {},
  ): ReactNode => (
    <Button
      size="sm"
      variant={options.primary ? "default" : "outline"}
      disabled={doing !== null}
      onClick={() => void run(label, work, options.leave === true)}
    >
      {doing === label ? doingLabel : label}
    </Button>
  );

  return (
    <SettingsPageContainer>
      <PageHeader title="Testing" />
      <Section label="This app">
        <Entry
          as="div"
          title="Start over as new"
          meta="Signs out and forgets every other computer. This one keeps its notes."
          actions={action("Start over", "Starting over…", startOver, {
            leave: true,
            primary: true,
          })}
        />
        {newOwnerCopy === undefined ? null : (
          <Entry
            as="div"
            title="Open as a new owner"
            meta="A second Majordome with an empty home: no notes, no account, no assistant."
            actions={action("Open", "Opening…", () => newOwnerCopy.openNewOwnerCopy())}
          />
        )}
      </Section>
      {account === null || (accounts.length === 0 && servers === null) ? null : (
        <Section label="Account">
          {servers === null ? null : (
            <Entry
              as="div"
              title={
                servers.count === 1
                  ? "1 server listed in this account"
                  : `${servers.count} servers listed in this account`
              }
              meta="A computer that is still connected lists itself again."
              actions={action("Empty the list", "Emptying…", servers.forget)}
            />
          )}
          {accounts.length === 0
            ? null
            : [{ label: NEW_TEST_ACCOUNT, email: freshTestEmail }, ...accounts.map(asChoice)].map(
                (test) => (
                  <Entry
                    key={test.label}
                    as="div"
                    title={test.label}
                    actions={action(
                      `Sign in as ${test.label.toLowerCase()}`,
                      "Signing in…",
                      async () => {
                        await startOver();
                        await signInAs(account, test.email());
                      },
                      { leave: true },
                    )}
                  />
                ),
              )}
        </Section>
      )}
      {problem === null ? null : (
        <p role="alert" className="mt-4 text-sm text-destructive-foreground">
          {problem}
        </p>
      )}
    </SettingsPageContainer>
  );
}

const freshTestEmail = () => newTestEmail(Date.now());

const asChoice = (test: { readonly label: string; readonly email: string }) => ({
  label: test.label,
  email: () => test.email,
});
