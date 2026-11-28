import { useClerk } from "@clerk/expo";
import { useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import {
  isUnknownAccount,
  NEW_TEST_ACCOUNT,
  newTestEmail,
  testAccounts,
  TEST_CODE,
  TEST_PASSWORD,
} from "@t3tools/shared/majordomeTesting";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../components/ui/ScreenScrollView";
import { environmentCatalog } from "../connection/catalog";
import { hasAccountPublicConfig, resolveCloudPublicConfig } from "../features/cloud/publicConfig";
import { SettingsScreen } from "../features/settings/components/SettingsScreen";
import { useAtomCommand } from "../state/use-atom-command";
import { savedConnectionsByIdAtom } from "../state/use-remote-environment-registry";
import { forgetHostedSignup } from "./hostedSignup";
import { forgetPhonePushOn } from "./phonePush";

/** Not in Settings' list: opened by a long press on the version, for trying the app as someone new. */
export function TestingScreen() {
  return hasAccountPublicConfig() ? <WithAccounts /> : <Testing account={null} />;
}

type Account = ReturnType<typeof useClerk>;

function WithAccounts() {
  return <Testing account={useClerk()} />;
}

const freshTestEmail = () => newTestEmail(Date.now());

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

function Testing({ account }: { readonly account: Account | null }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const connections = useAtomValue(savedConnectionsByIdAtom);
  const removeEnvironment = useAtomCommand(environmentCatalog.remove, "environment remove");
  const [doing, setDoing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const accounts =
    account === null ? [] : testAccounts(resolveCloudPublicConfig().clerk.publishableKey);

  const startOver = async () => {
    await Promise.allSettled(
      Object.keys(connections).map((id) =>
        forgetPhonePushOn(id).then(() => removeEnvironment(EnvironmentId.make(id))),
      ),
    );
    forgetHostedSignup();
    await account?.signOut();
  };

  const run = async (label: string, work: () => Promise<void>) => {
    setDoing(label);
    setProblem(null);
    try {
      await work();
      navigation.dispatch(StackActions.popToTop());
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure));
      setDoing(null);
    }
  };

  const signInButton = (label: string, email: () => string) => (
    <Button
      key={label}
      label={label}
      loading={doing === label}
      disabled={doing !== null}
      onPress={() =>
        void run(label, async () => {
          await startOver();
          if (account !== null) await signInAs(account, email());
        })
      }
    />
  );

  return (
    <SettingsScreen title="Testing">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-7 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Button
          label="Start over as new"
          tone="primary"
          loading={doing === "startOver"}
          disabled={doing !== null}
          onPress={() => void run("startOver", startOver)}
        />
        {accounts.length === 0 ? null : (
          <View className="gap-3">
            <Text className="text-foreground-muted">Sign in as</Text>
            {signInButton(NEW_TEST_ACCOUNT, freshTestEmail)}
            {accounts.map((test) => signInButton(test.label, () => test.email))}
          </View>
        )}
        {problem === null ? null : (
          <Text accessibilityRole="alert" className="text-danger-foreground">
            {problem}
          </Text>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}
