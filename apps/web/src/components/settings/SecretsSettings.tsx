import type { EnvironmentId, SecretProviderConfig, SecretProviderId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { isMajordome } from "../../env";
import { type EnvironmentPresentation, useEnvironments } from "../../state/environments";
import { useEnvironmentSessionState } from "../../state/session";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { isHostedServer, machineInSentence } from "../majordome/brains.logic";
import { ComputerSwitch, useShownComputer } from "../majordome/ComputerSwitch";
import { SavedKeysSection } from "../majordome/SavedKeysSection";
import { useMachineNames } from "../majordome/useMachineNames";
import { useAssistantEnvironmentId, useMajordomeVaults } from "../majordome/useMajordomeVaults";
import { Button } from "../ui/button";
import { SecretProviderDialog } from "./SecretProviderDialog";
import { classifySecretProvider } from "./SecretProviderDialog.logic";
import { secretProviderUses } from "./SecretsSettings.logic";
import {
  classifyProviderEnvironmentAccess,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { SecretProviderIcon } from "./secretProviderIcons";

export function SecretsSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const { scope, environment } = useSettingsScope();
  const { environments } = useEnvironments();
  const { primaryEnvironmentId, machineOf } = useMachineNames();
  const { activeVault } = useMajordomeVaults();
  const answers = useAssistantEnvironmentId();
  // Majordome lists the keys of every connected computer that holds the notes as one list, the
  // one that answers the chats first; T3 Code shows the environment chosen above the page.
  const holders = new Set(activeVault?.copies.map((copy) => copy.environmentId));
  const rank = (id: EnvironmentId) => (id === answers ? 0 : id === primaryEnvironmentId ? 1 : 2);
  const together = isMajordome
    ? environments
        .filter(
          (candidate) =>
            candidate.connection.phase === "connected" && holders.has(candidate.environmentId),
        )
        .toSorted((left, right) => rank(left.environmentId) - rank(right.environmentId))
    : [];
  const machines =
    together.length > 0
      ? together
      : environment?.connection.phase === "connected"
        ? [environment]
        : [];
  const choices = machines.map((machine) => ({
    id: machine.environmentId as string,
    label: machineOf(machine.environmentId),
    machine,
  }));
  const [shown, showComputer] = useShownComputer(choices);
  if (shown === null) {
    return (
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("secret-providers")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Connect to a server to manage where its key and token fields read secrets from.
          </p>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  return (
    <SettingsPageContainer>
      <SavedKeysSection
        computers={machines.map((machine) => {
          const name = machineOf(machine.environmentId);
          return {
            environmentId: machine.environmentId,
            name: machineInSentence(name),
            hosted: isHostedServer(name),
          };
        })}
        answers={answers}
        sourcesOn={shown.machine.environmentId}
      />
      {choices.length > 1 ? (
        <p className="text-sm text-muted-foreground">
          Each computer has its own places to read a key from. A key kept in one of them works only
          on that computer.
        </p>
      ) : null}
      <ComputerSwitch choices={choices} shownId={shown.id} onShow={showComputer} />
      {shown.machine.serverConfig !== null &&
      shown.machine.serverConfig.secretProviderSettings !== true ? (
        <SettingsSection {...searchableSetting("secret-providers")}>
          <p className="px-4 py-3 text-sm text-muted-foreground">
            Update Majordome on {shown.machine.label} to manage where it reads secrets from.
          </p>
        </SettingsSection>
      ) : (
        <EnvironmentSecretProviders
          key={shown.machine.environmentId}
          environment={shown.machine}
          projectScoped={scope.kind === "project" || scope.kind === "checkout"}
        />
      )}
    </SettingsPageContainer>
  );
}

function EnvironmentSecretProviders({
  environment,
  projectScoped,
}: {
  readonly environment: EnvironmentPresentation;
  readonly projectScoped: boolean;
}) {
  const environmentId = environment.environmentId;
  const searchableSetting = useSearchableSetting();
  const sessionState = useEnvironmentSessionState(environmentId);
  // The server requires the same grant for secret providers as for provider settings.
  const access = classifyProviderEnvironmentAccess({
    connectionPhase: environment.connection.phase,
    hasServerConfig: environment.serverConfig !== null,
    operateAccess: resolveRemoteOperateAccess({
      session: sessionState.data,
      isPending: sessionState.isPending,
      hasError: sessionState.hasError,
    }),
  });
  const readOnly = access.kind !== "editable" || projectScoped;
  const providers = useEnvironmentSettings(environmentId, (settings) => settings.secretProviders);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [dialog, setDialog] = useState<
    null | { readonly mode: "add" } | { readonly mode: "edit"; readonly id: SecretProviderId }
  >(null);
  const entries = Object.entries(providers) as Array<[SecretProviderId, SecretProviderConfig]>;
  const serverOs = environment.serverConfig?.environment.platform.os;
  const editingConfig = dialog?.mode === "edit" ? providers[dialog.id] : undefined;
  const editing =
    dialog?.mode === "edit" && editingConfig !== undefined
      ? { id: dialog.id, config: editingConfig }
      : undefined;
  return (
    <>
      <SettingsSection
        {...searchableSetting("secret-providers")}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="outline" onClick={() => setDialog({ mode: "add" })}>
              <PlusIcon className="size-3" aria-hidden />
              Add source
            </Button>
          ) : null
        }
      >
        {projectScoped ? (
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            Environment-wide setting. Select an environment to change it.
          </p>
        ) : null}
        {entries.length === 0 ? (
          <SettingsRow
            title="No secret sources yet."
            description="Add the Mac Keychain, an encrypted file, 1Password or another place, then pick it next to a key or token field instead of pasting the value."
          />
        ) : (
          entries.map(([id, config]) => {
            const classified = classifySecretProvider(config);
            const supported = classified.kind === "supported" ? classified : undefined;
            return (
              <SettingsRow
                key={id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    {supported ? (
                      <SecretProviderIcon
                        kind={supported.definition.kind}
                        className="size-4.5 shrink-0 text-foreground/80"
                      />
                    ) : null}
                    <span className="min-w-0 wrap-anywhere">{config.label}</span>
                  </span>
                }
                description={
                  supported === undefined ? (
                    `Not supported by this version (${config.kind})`
                  ) : supported.summary === undefined ? (
                    supported.definition.label
                  ) : (
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="shrink-0">{supported.definition.label} ·</span>
                      {supported.summary.sensitive ? (
                        <RedactedSensitiveText
                          value={supported.summary.text}
                          ariaLabel="Toggle account visibility"
                          revealTooltip="Click to reveal account"
                          hideTooltip="Click to hide account"
                          className="max-w-full truncate"
                        />
                      ) : (
                        <span className="max-w-full truncate">{supported.summary.text}</span>
                      )}
                    </span>
                  )
                }
                control={
                  !readOnly ? (
                    <div className="flex items-center gap-1">
                      {supported ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDialog({ mode: "edit", id })}
                        >
                          Edit
                        </Button>
                      ) : null}
                      <RemoveSecretProviderButton
                        environmentId={environmentId}
                        id={id}
                        label={config.label}
                        onConfirm={() => updateSettings({ secretProviders: { [id]: null } })}
                      />
                    </div>
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {dialog !== null && !readOnly && (dialog.mode === "add" || editing !== undefined) ? (
        <SecretProviderDialog
          onClose={() => setDialog(null)}
          environmentId={environmentId}
          environmentLabel={environment.label}
          environmentOs={serverOs === "unknown" ? undefined : serverOs}
          existingIds={new Set(Object.keys(providers))}
          {...(editing === undefined ? {} : { existing: editing })}
        />
      ) : null}
    </>
  );
}

function RemoveSecretProviderButton({
  environmentId,
  id,
  label,
  onConfirm,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: SecretProviderId;
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <SecretProviderUses environmentId={environmentId} id={id} label={label} />
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove source
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function SecretProviderUses({
  environmentId,
  id,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly id: SecretProviderId;
  readonly label: string;
}) {
  const uses = secretProviderUses(useEnvironmentSettings(environmentId), id);
  if (uses.length === 0) {
    return (
      <AlertDialogDescription>
        Nothing reads from {label}. The secrets themselves are untouched.
      </AlertDialogDescription>
    );
  }
  return (
    <>
      <AlertDialogDescription>
        These read from {label} and will be unset. The secrets themselves are untouched.
      </AlertDialogDescription>
      <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto ps-5 text-sm wrap-anywhere">
        {uses.map((use) => (
          <li key={use.id}>{use.label}</li>
        ))}
      </ul>
    </>
  );
}
