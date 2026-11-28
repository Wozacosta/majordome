import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  isManagedDriverAllowed,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { SymbolView } from "../components/ui/AppSymbol";
import { AppText as Text } from "../components/ui/AppText";
import { Button } from "../components/ui/Button";
import { MajordomeAiAccount } from "../features/settings/SettingsProviderAccountsRouteScreen";
import { useProjects } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { assistantAis, assistantStanding, listedAssistantAis } from "./assistantAi.logic";
import {
  Card,
  ClaudeSignInCard,
  claudeSignInStepAtom,
  Problem,
  useMachineName,
} from "./ClaudeSignInCard";
import { openSetupPage, SETUP_FAILED, SETUP_NOT_ALLOWED } from "./hostedSignup";
import { majordomeEnvironment, vaultTopicsAtom } from "./state";

/**
 * The AI the assistant answers with, signed in on the phone: Claude, ChatGPT or Gemini while none
 * is, then only the ones that are. With `onlyWhenNeeded` nothing shows unless a sign-in here is
 * what the assistant is waiting for.
 */
export function AssistantSetup(props: {
  readonly environmentId: EnvironmentId;
  readonly onlyWhenNeeded?: boolean;
}) {
  const { environmentId } = props;
  const machine = useMachineName(environmentId);
  const policy = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.managedPolicy;
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId))?.filter(
    (provider) => isManagedDriverAllowed(policy, provider.driver),
  );
  const allowed = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const claudeStep = useAtomValue(claudeSignInStepAtom(environmentId));
  const waiting = allowed && assistantStanding(providers) === "choose";
  if (props.onlyWhenNeeded && !waiting && claudeStep.kind === "idle") return null;
  if (providers == null) {
    return (
      <Card>
        <Text textRole="footnote" className="text-foreground-muted">
          Checking…
        </Text>
      </Card>
    );
  }
  // A Claude sign-in under way keeps its card when another AI gets ready meanwhile.
  const ais = claudeStep.kind === "idle" ? listedAssistantAis(providers) : assistantAis(providers);
  return (
    <View className="gap-4">
      {ais.map((ai) =>
        ai.provider.driver === "claudeAgent" ? (
          <ClaudeSignInCard key={ai.provider.instanceId} environmentId={environmentId} />
        ) : allowed ? (
          <View
            key={ai.provider.instanceId}
            className="overflow-hidden rounded-[22px] border border-border bg-card"
          >
            <MajordomeAiAccount
              environment={{ environmentId, label: machine }}
              provider={ai.provider}
              prominent
            />
          </View>
        ) : null,
      )}
    </View>
  );
}

/** Whether the computer already has a notes folder among its projects. */
function useHasNotes(environmentId: EnvironmentId): boolean {
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === environmentId && !project.archivedAt && !project.isScratch,
  );
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  return useAtomValue(vaultTopicsAtom(key)).some(
    (result) => AsyncResult.getOrElse(result, () => null)?.isVault === true,
  );
}

/**
 * What is left before a computer can be used, done on the phone: an AI's sign-in and a new
 * notes folder. The computer's own page stays one tap away for what the phone has no screen for.
 */
export function FinishSetup(props: {
  readonly environmentId: EnvironmentId;
  /** Given where the setup is a step to leave: called once the notes are there. */
  readonly onDone?: () => void;
}) {
  const { environmentId } = props;
  const hasNotes = useHasNotes(environmentId);
  const startNotes = useAtomCommand(majordomeEnvironment.startNotes, { reportFailure: false });
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const start = async () => {
    setStarting(true);
    setProblem(null);
    const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions();
    const result = await startNotes({
      environmentId,
      input: { folder: null, about: { language: locale, timeZone } },
    });
    setStarting(false);
    if (result._tag === "Success") {
      props.onDone?.();
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setProblem(error instanceof Error ? error.message : "Your notes couldn't be started.");
    }
  };

  const openPage = async () => {
    setOpening(true);
    setProblem(null);
    const result = await openSetupPage(environmentId);
    setOpening(false);
    if (result !== "opened") setProblem(result === "notAllowed" ? SETUP_NOT_ALLOWED : SETUP_FAILED);
  };

  return (
    <View className="gap-4">
      <AssistantSetup environmentId={environmentId} />
      <Card>
        <View className="flex-row items-center gap-3">
          <Text textRole="headline" className="min-w-0 flex-1 font-t3-bold text-foreground">
            Notes
          </Text>
          {hasNotes ? (
            <SymbolView
              name="checkmark.circle.fill"
              size={22}
              tintColorClassName="accent-primary-text"
            />
          ) : (
            <Button
              label="Start new notes"
              tone="primary"
              size="compact"
              loading={starting}
              onPress={() => void start()}
            />
          )}
        </View>
        <Problem text={problem} />
      </Card>
      {hasNotes ? (
        props.onDone === undefined ? null : (
          <Button label="Done" tone="primary" fullWidth onPress={props.onDone} />
        )
      ) : (
        <View className="items-center">
          <Button
            label="Restore a backup or use notes you have"
            tone="text"
            size="compact"
            icon="safari"
            loading={opening}
            onPress={() => void openPage()}
          />
        </View>
      )}
    </View>
  );
}
