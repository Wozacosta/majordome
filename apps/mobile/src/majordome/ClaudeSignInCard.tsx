import { useAtom, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  type ClaudeSignInAttempt,
  type EnvironmentId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { claudeSignInFailure } from "@t3tools/shared/claudeSignIn";
import * as Redacted from "effect/Redacted";
import { Atom } from "effect/reactivity";
import * as Clipboard from "expo-clipboard";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { tryOpenExternalUrl } from "../lib/openExternalUrl";
import { serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { useWorkspaceState } from "../state/workspace";
import { assistantAis } from "./assistantAi.logic";
import { claudeSetupRow } from "./finishSetup.logic";

type SignInStep =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | {
      readonly kind: "link";
      readonly instanceId: ProviderInstanceId;
      readonly attempt: ClaudeSignInAttempt;
      readonly finishing: boolean;
    };

// Kept outside the card: Claude's page takes the screen, the connection drops meanwhile and the
// card is drawn anew on return, when the code still has to be pasted.
export const claudeSignInStepAtom = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make<SignInStep>({ kind: "idle" }).pipe(Atom.keepAlive),
);

export function Card(props: { readonly children: ReactNode }) {
  return (
    <View className="gap-3 rounded-[22px] border border-border bg-card p-5">{props.children}</View>
  );
}

export function Problem(props: { readonly text: string | null }) {
  return props.text === null ? null : (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      textRole="footnote"
      className="text-danger-foreground"
    >
      {props.text}
    </Text>
  );
}

export function useMachineName(environmentId: EnvironmentId): string {
  const { environments } = useWorkspaceState();
  return (
    environments.find((environment) => environment.environmentId === environmentId)
      ?.environmentLabel ?? "your computer"
  );
}

/**
 * Claude's sign-in for the computer, done on the phone: its page opens in the phone's browser
 * and the code it shows is pasted back.
 */
export function ClaudeSignInCard(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const machine = useMachineName(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const allowed = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const commands = { reportFailure: false, reportDefect: false };
  const start = useAtomCommand(serverEnvironment.startClaudeSignIn, commands);
  const submit = useAtomCommand(serverEnvironment.submitClaudeSignIn, commands);
  const cancel = useAtomCommand(serverEnvironment.cancelClaudeSignIn, commands);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, commands);
  const [step, setStep] = useAtom(claudeSignInStepAtom(environmentId));
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const claude = assistantAis(providers).find((ai) => ai.provider.driver === "claudeAgent");
  const row = claudeSetupRow(claude?.state ?? "checking", allowed, machine);

  // The phone's own browser, not a tab inside the app: that one starts with none of the owner's
  // sign-ins, so Google or Claude would ask for them again.
  const openPage = async (url: string) => {
    if (!(await tryOpenExternalUrl(url, "provider-auth"))) {
      setProblem("Claude's sign-in page couldn't be opened. Try again.");
    }
  };

  const begin = async (instanceId: ProviderInstanceId) => {
    setStep({ kind: "starting" });
    setCode("");
    setProblem(null);
    const result = await start({ environmentId, input: { instanceId } });
    if (result._tag === "Success") {
      setStep({ kind: "link", instanceId, attempt: result.value, finishing: false });
      void openPage(result.value.url);
      return;
    }
    setStep({ kind: "idle" });
    if (!isAtomCommandInterrupted(result)) {
      setProblem(claudeSignInFailure(squashAtomCommandFailure(result), machine).message);
    }
  };

  const finish = async (open: Extract<SignInStep, { kind: "link" }>, pasted: string) => {
    const value = pasted.trim();
    if (value === "") return;
    setStep({ ...open, finishing: true });
    setProblem(null);
    const result = await submit({
      environmentId,
      input: {
        instanceId: open.instanceId,
        attemptId: open.attempt.attemptId,
        code: Redacted.make(value),
      },
    });
    setCode("");
    if (result._tag === "Success") {
      await refreshProviders({ environmentId, input: { instanceId: open.instanceId } });
      setStep({ kind: "idle" });
      return;
    }
    const failure = claudeSignInFailure(squashAtomCommandFailure(result), machine);
    setStep(failure.attemptOpen ? { ...open, finishing: false } : { kind: "idle" });
    setProblem(failure.message);
  };

  const stop = (open: Extract<SignInStep, { kind: "link" }>) => {
    setStep({ kind: "idle" });
    setCode("");
    setProblem(null);
    void cancel({
      environmentId,
      input: { instanceId: open.instanceId, attemptId: open.attempt.attemptId },
    });
  };

  const paste = async (open: Extract<SignInStep, { kind: "link" }>) => {
    const pasted = await Clipboard.getStringAsync().catch(() => "");
    if (pasted.trim() === "") {
      setProblem("There is nothing to paste yet. Copy the code on Claude's page first.");
      return;
    }
    setCode(pasted.trim());
    await finish(open, pasted);
  };

  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text textRole="headline" className="font-t3-bold text-foreground">
            Claude
          </Text>
          {step.kind === "link" ? null : (
            <Text textRole="footnote" className="text-foreground-muted">
              {step.kind === "starting" ? "Getting your sign-in page…" : row.text}
            </Text>
          )}
        </View>
        {row.kind === "ready" ? (
          <SymbolView
            name="checkmark.circle.fill"
            size={22}
            tintColorClassName="accent-primary-text"
          />
        ) : row.kind === "signIn" && claude !== undefined && step.kind !== "link" ? (
          <Button
            label="Sign in"
            tone="primary"
            size="compact"
            loading={step.kind === "starting"}
            onPress={() => void begin(claude.provider.instanceId)}
          />
        ) : null}
      </View>
      {step.kind === "link" ? (
        <>
          <Text className="text-foreground">
            Approve on Claude's page, copy the code it shows, then come back and paste it here.
          </Text>
          <TextInput
            accessibilityLabel="Code from Claude"
            placeholder="Code from Claude"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="done"
            maxLength={4096}
            editable={!step.finishing}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={() => void finish(step, code)}
          />
          <View className="flex-row flex-wrap items-center gap-2">
            {code.trim() === "" ? (
              <Button
                label="Paste code"
                tone="primary"
                size="compact"
                loading={step.finishing}
                onPress={() => void paste(step)}
              />
            ) : (
              <Button
                label="Finish sign-in"
                tone="primary"
                size="compact"
                loading={step.finishing}
                onPress={() => void finish(step, code)}
              />
            )}
            <Button
              label="Open again"
              size="compact"
              disabled={step.finishing}
              onPress={() => void openPage(step.attempt.url)}
            />
            <Button
              label="Cancel"
              tone="text"
              size="compact"
              disabled={step.finishing}
              onPress={() => stop(step)}
            />
          </View>
        </>
      ) : null}
      <Problem text={problem} />
    </Card>
  );
}
