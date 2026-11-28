import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { T, useGT, Var } from "gt-react-native";
import * as Dialog from "../../components/ui/Dialog";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  isManagedDriverAllowed,
  type ProviderAuthResponse,
  type ServerProvider,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { m } from "../../i18n/messages";

import type { MenuAction } from "@react-native-menu/menu";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentsWithScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { AddClaudeAccount, ClaudeAccount } from "./ClaudeAccounts";
import { CLAUDE_DRIVER } from "./claude-accounts";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { isMajordome } from "../../majordome/env";
import {
  aiAccountKind,
  aiInstallStep,
  assistantAccountName,
  assistantAis,
  computerAiStanding,
  turnOnAiMutation,
} from "../../majordome/assistantAi.logic";
import { ClaudeSignInCard } from "../../majordome/ClaudeSignInCard";
import { aiAccountsRow, MAJORDOME_AI_SIGN_IN } from "../../majordome/settingsRows";

export function SettingsProviderAccountsRouteScreen() {
  const gt = useGT();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const permittedEnvironments = useEnvironmentsWithScope(selectedTargets, AuthProvidersManageScope);
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen
      title={
        !isMajordome
          ? gt("Providers")
          : aiAccountsRow(
              selectedTargets.map((environment) =>
                computerAiStanding(
                  managedProviders(environment, providersByEnvironment),
                  environment.serverConfig.settings.defaultModelSelection?.instanceId,
                ),
              ),
            ).label
      }
      // Majordome lists every connected computer: its Settings has no filter.
      menus={isMajordome ? [] : [environmentMenu]}
    >
      <ScreenScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {selectedTargets.length === 0 ? (
          <Text className="text-foreground-muted">
            <T>Select a connected environment.</T>
          </Text>
        ) : (
          selectedTargets.map((environment) =>
            isMajordome ? (
              <MajordomeComputerAccounts
                key={environment.environmentId}
                environment={environment}
                title={selectedTargets.length > 1 ? environment.label : undefined}
                permitted={permittedEnvironments.has(environment.environmentId)}
                providers={managedProviders(environment, providersByEnvironment)}
              />
            ) : (
              <SettingsSection key={environment.environmentId} title={environment.label}>
                {!permittedEnvironments.has(environment.environmentId) ? (
                  <View className="gap-1 p-4">
                    <Text className="text-base text-foreground">
                      <T>Limited permissions</T>
                    </Text>
                    <Text className="text-sm text-foreground-muted">
                      {gt(
                        "This session can view {environment}''s providers but can't change their settings.",
                        { environment: environment.label },
                      )}
                    </Text>
                  </View>
                ) : (
                  <EnvironmentProviders
                    environment={environment}
                    providers={managedProviders(environment, providersByEnvironment)}
                  />
                )}
              </SettingsSection>
            ),
          )
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}

/**
 * One computer's AI accounts as Majordome shows them: Claude first, signed in from the phone
 * through its own page, then ChatGPT and Gemini, then any other account the computer offers a
 * sign-in for. A second Claude account is set up on the computer, where its folder is.
 */
function MajordomeComputerAccounts(props: {
  readonly environment: SettingsTarget;
  readonly title: string | undefined;
  readonly permitted: boolean;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const offered = assistantAis(props.providers)
    .map((ai) => ai.provider)
    .filter((provider) => provider.driver !== CLAUDE_DRIVER);
  const accounts = props.permitted
    ? [
        ...offered,
        ...props.providers.filter(
          (provider) =>
            provider.driver !== CLAUDE_DRIVER &&
            !offered.includes(provider) &&
            provider.installed &&
            canManageProvider(provider),
        ),
      ]
    : [];
  const hasClaude = props.providers.some((provider) => provider.driver === CLAUDE_DRIVER);
  return (
    <View className="gap-3">
      {props.title === undefined ? null : (
        <Text textRole="footnote" className="px-2 font-t3-medium text-foreground-muted">
          {props.title}
        </Text>
      )}
      {hasClaude ? <ClaudeSignInCard environmentId={props.environment.environmentId} /> : null}
      {accounts.length === 0 ? null : (
        <SettingsSection>
          {accounts.map((provider, index) => (
            <MajordomeAiAccount
              key={provider.instanceId}
              environment={props.environment}
              provider={provider}
              divider={index > 0}
            />
          ))}
        </SettingsSection>
      )}
    </View>
  );
}

type AccountEnvironment = Pick<SettingsTarget, "environmentId" | "label">;

/**
 * An AI account under the name Majordome gives it. One that is off, or a ChatGPT that would sign
 * in on the computer's own screen, first gets turned on for the sign-in a phone can do.
 */
export function MajordomeAiAccount(props: {
  readonly environment: AccountEnvironment;
  readonly provider: ServerProvider;
  readonly divider?: boolean;
  /** Drawn as a card of its own, as on the setup screen. */
  readonly prominent?: boolean;
}) {
  const { environment, provider } = props;
  const gt = useGT();
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environment.environmentId));
  const mutate = useAtomCommand(serverEnvironment.mutateProviderInstance, {
    reportFailure: false,
    reportDefect: false,
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const name = assistantAccountName(provider);
  const kind = aiAccountKind(provider);
  if (kind === "account") {
    return (
      <ProviderAccount
        environment={environment}
        provider={provider}
        name={name}
        divider={props.divider ?? false}
        prominent={props.prominent}
      />
    );
  }
  const setUp = async () => {
    setPending(true);
    setFailed(false);
    const result = await mutate({
      environmentId: environment.environmentId,
      input: {
        patch: {},
        providerInstanceMutation: turnOnAiMutation(
          provider,
          settings?.providerInstances[provider.instanceId],
        ),
      },
    });
    setPending(false);
    setFailed(result._tag !== "Success" && !isAtomCommandInterrupted(result));
  };
  return (
    <View className={props.divider ? "border-t border-border-subtle" : undefined}>
      <View
        className={
          props.prominent
            ? "min-h-16 flex-row items-center gap-3 px-5 py-4"
            : "min-h-16 flex-row items-center gap-3 px-4 py-3"
        }
      >
        <ProviderAccountSummary
          name={name}
          status={failed ? MAJORDOME_AI_SIGN_IN.failed : kind === "setUp" ? null : gt("Signed in")}
          email={undefined}
          prominent={props.prominent}
        />
        {kind !== "setUp" ? null : pending ? (
          <View className="h-11 w-11 items-center justify-center">
            <AppActivityIndicator colorClassName="accent-icon" />
          </View>
        ) : (
          <ControlPill
            variant="primary"
            label={MAJORDOME_AI_SIGN_IN.setUp}
            accessibilityLabel={`${MAJORDOME_AI_SIGN_IN.setUp} ${name}`}
            disabled={settings === null}
            onPress={() => void setUp()}
          />
        )}
      </View>
    </View>
  );
}

function EnvironmentProviders({
  environment,
  providers,
}: {
  readonly environment: SettingsTarget;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const accounts = providers.filter(canManageProvider);
  // Claude has no in-app sign-in; each account is its own instance on a signed-in config folder.
  const claudeAccounts = providers.filter(
    (provider) => provider.driver === CLAUDE_DRIVER && !canManageProvider(provider),
  );
  const canAddClaude = isManagedDriverAllowed(
    environment.serverConfig.managedPolicy,
    CLAUDE_DRIVER,
  );
  return (
    <>
      {accounts.map((provider, index) => (
        <ProviderAccount
          key={provider.instanceId}
          environment={environment}
          provider={provider}
          divider={index > 0}
        />
      ))}
      {accounts.length === 0 ? (
        <Text className="p-4 text-foreground-muted">
          <T>Configure a provider with in-app sign-in in web or desktop Settings.</T>
        </Text>
      ) : null}
      {claudeAccounts.map((provider) => (
        <ClaudeAccount key={provider.instanceId} environment={environment} provider={provider} />
      ))}
      {canAddClaude ? <AddClaudeAccount environment={environment} /> : null}
    </>
  );
}

/** Providers the environment's managed policy allows; the rest cannot run or sign in. */
function managedProviders(
  environment: SettingsTarget,
  providersByEnvironment: ReadonlyMap<string, ReadonlyArray<ServerProvider>>,
) {
  return (providersByEnvironment.get(environment.environmentId) ?? []).filter((provider) =>
    isManagedDriverAllowed(environment.serverConfig.managedPolicy, provider.driver),
  );
}

function canManageProvider(provider: ServerProvider) {
  return Boolean(
    provider.setup?.canAuthenticate || (provider.driver === "acpRegistry" && provider.installed),
  );
}

function ProviderAccount({
  environment,
  provider,
  divider,
  name: givenName,
  prominent,
}: {
  readonly environment: AccountEnvironment;
  readonly provider: ServerProvider;
  readonly divider: boolean;
  readonly name?: string;
  readonly prominent?: boolean | undefined;
}) {
  const gt = useGT();
  const environmentId = environment.environmentId;
  const instanceId = provider.instanceId;
  const target = { environmentId, input: { instanceId } };
  const auth = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const canInstall = provider.setup?.canInstall === true;
  const installation = useEnvironmentQuery(
    canInstall ? serverEnvironment.providerInstallState(target) : null,
  ).data;
  const options = { reportFailure: false, reportDefect: false };
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, options);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, options);
  const start = useAtomCommand(serverEnvironment.startProviderAuth, options);
  const respond = useAtomCommand(serverEnvironment.respondProviderAuth, options);
  const complete = useAtomCommand(serverEnvironment.completeProviderAuth, options);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, options);
  const logout = useAtomCommand(serverEnvironment.logoutProviderAuth, options);
  const removeMethod = useAtomCommand(serverEnvironment.removeProviderAuthMethod, options);
  const canRemoveMethod = useAtomValue(
    serverEnvironment.removeProviderAuthMethod.permissionAtom(environmentId),
  );
  // Matches ListRowLayout: large text stacks the action below instead of squeezing the status.
  const stacked = useWindowDimensions().fontScale >= 1.5;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ id: "", values: {} as Record<string, string> });
  const state = auth.data;
  const interaction = state?.interaction;
  const draftId = `${state?.flowId ?? ""}:${interaction?.id ?? ""}`;
  const values = draft.id === draftId ? draft.values : {};
  const active =
    state?.phase === "starting" || state?.phase === "waiting" || state?.phase === "verifying";
  const installStep = aiInstallStep(installation);
  // The provider's own status follows a finished install only after its next check.
  const installed = provider.installed || installation?.installedVersion != null;
  const needsInstall =
    canInstall && provider.enabled && !installed && installStep.kind === "idle" && !active;
  const signedIn =
    provider.auth.status === "authenticated" ||
    (provider.auth.status === "unknown" && state?.phase === "succeeded");
  const isDiscovering =
    provider.driver === "acpRegistry" &&
    !active &&
    !signedIn &&
    !auth.error &&
    state?.methods === undefined;
  const needsExternalSetup =
    !active &&
    !signedIn &&
    (provider.setup?.canAuthenticate === false ||
      (provider.driver === "acpRegistry" && state?.methods?.length === 0));
  const url =
    interaction?.type === "browser" || interaction?.type === "deviceCode"
      ? interaction.url
      : state?.authorizationUrl;
  const disabled = pending || auth.error !== null || isDiscovering;
  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const result = await command();
    pendingRef.current = false;
    setPending(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error
          ? (errorDisplayMessage(failure, m) ?? failure.message)
          : gt("Could not update provider sign-in."),
      );
    }
    return false;
  }
  function send(response: ProviderAuthResponse) {
    if (!state?.flowId || !interaction) return Promise.resolve(false);
    return run(() =>
      respond({
        environmentId,
        input: { instanceId, flowId: state.flowId!, interactionId: interaction.id, response },
      }),
    );
  }
  function field(name: string, label: string, secret: boolean) {
    return (
      <TextInput
        accessibilityLabel={label}
        className="rounded-lg border border-border-subtle px-3 py-2 text-base text-foreground"
        placeholderTextColorClassName="accent-foreground-muted"
        placeholder={label}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        maxLength={secret && interaction?.type === "terminal" ? 4_095 : 16_384}
        value={values[name] ?? ""}
        onChangeText={(value) => setDraft({ id: draftId, values: { ...values, [name]: value } })}
      />
    );
  }
  const name = givenName ?? provider.displayName ?? provider.driver;
  const email = signedIn && !active && provider.enabled ? provider.auth.email?.trim() : undefined;
  const methods = state?.methods ?? [];
  // The status line says why a provider that is missing or turned off can't sign in.
  const canSignIn =
    !active &&
    !needsExternalSetup &&
    provider.setup?.canAuthenticate !== false &&
    provider.enabled &&
    installed;
  const signInDisabled = disabled || state === null;
  const canSignOut =
    !active && signedIn && (provider.auth.canLogout ?? provider.setup?.canAuthenticate);
  const showCallback =
    Boolean(url) && (interaction?.type === "browser" ? interaction.acceptsCallback : !interaction);
  const usesCredentials =
    provider.driver === "antigravity" &&
    (provider.auth.type === "gemini-api-key" || provider.auth.type === "agent-platform");
  const status =
    active || state?.phase === "failed" || state?.phase === "cancelled"
      ? // The computer's own sentence is written for a developer.
        !isMajordome
        ? state.message
        : active
          ? MAJORDOME_AI_SIGN_IN.signingIn
          : MAJORDOME_AI_SIGN_IN.failed
      : !provider.enabled
        ? gt("Turned off")
        : installStep.kind === "downloading"
          ? installStep.total === null
            ? gt("Downloading {downloaded} MB", { downloaded: installStep.downloaded })
            : gt("Downloading {downloaded} of {total} MB", {
                downloaded: installStep.downloaded,
                total: installStep.total,
              })
          : installStep.kind === "installing"
            ? gt("Installing…")
            : needsInstall && installation?.phase === "failed"
              ? isMajordome
                ? MAJORDOME_AI_SIGN_IN.failed
                : (installation.message ?? gt("Not installed"))
              : signedIn
                ? gt("Signed in")
                : isDiscovering
                  ? gt("Discovering sign-in methods…")
                  : needsExternalSetup
                    ? gt(
                        "No in-app sign-in advertised. Follow the provider's docs to finish setup.",
                      )
                    : !installed
                      ? gt("Not installed")
                      : usesCredentials
                        ? gt("Connect to load models")
                        : gt("Not signed in");
  // A provider with several sign-in methods picks one from a menu on the same control.
  const methodActions: MenuAction[] = methods.map((method) => ({
    id: `method:${method.id}`,
    title: method.name,
  }));
  const removableMethods = methods.filter((method) => method.canRemove);
  const removeActions: MenuAction[] = removableMethods.length
    ? [
        {
          id: "remove",
          title: gt("Remove incomplete connection"),
          attributes: { disabled: disabled || active || !canRemoveMethod },
          subactions: removableMethods.map((method) => ({
            id: `remove:${method.id}`,
            title: method.name,
            attributes: { destructive: true, disabled: disabled || active || !canRemoveMethod },
          })),
        },
      ]
    : [];
  function startSignIn(methodId?: string) {
    void run(() => start(methodId ? { environmentId, input: { instanceId, methodId } } : target));
  }
  function signOut() {
    Dialog.alert(
      gt("Sign out?"),
      isMajordome
        ? MAJORDOME_AI_SIGN_IN.signOutEffect(environment.label)
        : gt(
            "Running threads sharing this sign-in on {environment} will stop. Thread history is kept.",
            { environment: environment.label },
          ),
      [
        { text: gt("Cancel"), style: "cancel" },
        {
          text: gt("Sign out"),
          style: "destructive",
          onPress: () => {
            void run(() => logout(target));
          },
        },
      ],
    );
  }
  function onMenuAction(id: string) {
    if (id === "signOut") signOut();
    // iOS keeps a disabled submenu's children selectable, so sign-in guards here too.
    else if (signInDisabled) return;
    else if (id.startsWith("remove:")) {
      if (active || !canRemoveMethod) return;
      const methodId = id.slice("remove:".length);
      if (!removableMethods.some((method) => method.id === methodId)) return;
      void run(() => removeMethod({ environmentId, input: { instanceId, methodId } }));
    } else if (id.startsWith("method:")) startSignIn(id.slice("method:".length));
    else if (id === "change") startSignIn();
  }
  const accountActions: MenuAction[] = [
    ...removeActions,
    ...(canSignIn
      ? [
          {
            id: "change",
            title: gt("Change account"),
            image: "person.crop.circle",
            attributes: { disabled: signInDisabled },
            ...(methodActions.length > 1
              ? {
                  subactions: methodActions.map((action) => ({
                    ...action,
                    attributes: { disabled: signInDisabled },
                  })),
                }
              : {}),
          },
        ]
      : []),
    ...(canSignOut
      ? [
          {
            id: "signOut",
            title: gt("Sign out"),
            image: "rectangle.portrait.and.arrow.right",
            attributes: { destructive: true, disabled: disabled || state === null },
          },
        ]
      : []),
  ];
  const trailing = pending ? (
    <View className="h-11 w-11 items-center justify-center">
      <AppActivityIndicator colorClassName="accent-icon" />
    </View>
  ) : needsExternalSetup && provider.setup?.documentationUrl ? (
    <ControlPill
      variant="pill"
      label={gt("Docs")}
      onPress={() => {
        void tryOpenExternalUrl(provider.setup!.documentationUrl!).then((opened) => {
          if (!opened) setError(gt("Could not open the provider docs."));
        });
      }}
    />
  ) : installStep.kind !== "idle" ? (
    installation?.operationId ? (
      <ControlPill
        variant="pill"
        label={gt("Cancel")}
        accessibilityLabel={gt("Cancel {provider} installation", { provider: name })}
        onPress={() => {
          const operationId = installation.operationId;
          if (!operationId) return;
          void run(() => cancelInstall({ environmentId, input: { instanceId, operationId } }));
        }}
      />
    ) : null
  ) : needsInstall ? (
    <ControlPill
      variant="primary"
      label={gt("Install")}
      accessibilityLabel={gt("Install {provider}", { provider: name })}
      onPress={() => void run(() => startInstall(target))}
    />
  ) : active && state?.flowId ? (
    <ControlPill
      variant="pill"
      label={gt("Cancel")}
      accessibilityLabel={gt("Cancel {provider} sign-in", { provider: name })}
      disabled={disabled}
      onPress={() => {
        void run(() => cancel({ environmentId, input: { instanceId, flowId: state.flowId! } }));
      }}
    />
  ) : signedIn && !active && accountActions.length > 0 ? (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={gt("{provider} account options", { provider: name })}
      title={name}
      actions={accountActions}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <ControlPill
        icon="ellipsis"
        accessibilityLabel={gt("{provider} account options", { provider: name })}
      />
    </Menu>
  ) : canSignIn && !signedIn && methodActions.length > 1 && !signInDisabled ? (
    <Menu
      accessible
      accessibilityRole="button"
      accessibilityLabel={gt("Sign in to {provider}", { provider: name })}
      title={gt("Sign in with")}
      actions={[...methodActions, ...removeActions]}
      onPressAction={({ nativeEvent }) => onMenuAction(nativeEvent.event)}
    >
      <ControlPill
        variant="primary"
        label={gt("Sign in")}
        accessibilityLabel={gt("Sign in to {provider}", { provider: name })}
      />
    </Menu>
  ) : canSignIn && !signedIn ? (
    <ControlPill
      variant="primary"
      label={usesCredentials ? gt("Connect") : gt("Sign in")}
      accessibilityLabel={
        usesCredentials
          ? gt("Connect to {provider}", { provider: name })
          : gt("Sign in to {provider}", { provider: name })
      }
      disabled={signInDisabled}
      onPress={() => startSignIn()}
    />
  ) : null;
  return (
    <View className={divider ? "border-t border-border-subtle" : undefined}>
      <View
        className={
          stacked
            ? "min-h-16 items-start gap-3 px-4 py-3"
            : prominent
              ? "min-h-16 flex-row items-center gap-3 px-5 py-4"
              : "min-h-16 flex-row items-center gap-3 px-4 py-3"
        }
      >
        <ProviderAccountSummary
          key={email}
          name={name}
          status={status}
          email={email}
          prominent={prominent}
        />
        {trailing}
      </View>
      {interaction?.type === "deviceCode" ||
      interaction?.type === "terminal" ||
      interaction?.type === "credentials" ||
      showCallback ||
      error ||
      auth.error ? (
        <View className="gap-2 px-4 pb-3">
          {interaction?.type === "deviceCode" ? (
            <Text selectable className="text-foreground">
              <T>
                Enter code <Var>{interaction.userCode}</Var> on the sign-in page.
              </T>
            </Text>
          ) : null}
          {interaction?.type === "terminal" ? (
            <>
              <ScrollView className="max-h-64" nestedScrollEnabled>
                <Text selectable className="font-mono text-sm text-foreground">
                  {interaction.output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")}
                </Text>
              </ScrollView>
              {field("input", gt("Terminal response"), true)}
              <SettingsActionRow
                icon="arrow.up"
                label={gt("Send response")}
                disabled={disabled}
                onPress={() => {
                  void send({ type: "terminal", data: `${values.input ?? ""}\r` }).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {interaction?.type === "credentials" ? (
            <>
              {interaction.fields.map((entry) => (
                <View key={entry.name}>{field(entry.name, entry.label, entry.secret)}</View>
              ))}
              <SettingsActionRow
                icon="person.crop.circle"
                label={gt("Connect")}
                disabled={disabled}
                onPress={() => {
                  void send({ type: "credentials", values }).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {showCallback ? (
            <>
              {field(
                "callback",
                isMajordome ? MAJORDOME_AI_SIGN_IN.pasteBack : gt("Final localhost URL"),
                false,
              )}
              <SettingsActionRow
                icon="arrow.right"
                label={gt("Continue")}
                disabled={disabled || !values.callback?.trim()}
                onPress={() => {
                  if (!state?.flowId) return;
                  void run(() =>
                    complete({
                      environmentId,
                      input: { instanceId, flowId: state.flowId!, callbackUrl: values.callback! },
                    }),
                  ).then((sent) => {
                    if (sent) setDraft({ id: "", values: {} });
                  });
                }}
              />
            </>
          ) : null}
          {error || auth.error ? (
            <Text accessibilityRole="alert" className="text-danger-foreground">
              {error ?? auth.error}
            </Text>
          ) : null}
        </View>
      ) : null}
      {url ? (
        <SettingsActionRow
          icon="globe"
          label={gt("Open sign-in page")}
          disabled={disabled}
          onPress={() => {
            void (async () => {
              if (
                interaction?.type === "browser" &&
                interaction.requiresConsent &&
                !(await send({ type: "browser", action: "accept" }))
              )
                return;
              if (!(await tryOpenExternalUrl(url, "provider-auth")))
                setError(gt("Could not open the sign-in page."));
            })().catch(() => setError(gt("Could not open the sign-in page.")));
          }}
        />
      ) : null}
    </View>
  );
}

function ProviderAccountSummary({
  name,
  status,
  email,
  prominent,
}: {
  readonly name: string;
  readonly status: string | null | undefined;
  readonly email: string | undefined;
  readonly prominent?: boolean | undefined;
}) {
  const gt = useGT();
  const [revealed, setRevealed] = useState(false);
  const content = (
    <>
      <Text
        textRole={prominent ? "headline" : "body"}
        className={prominent ? "font-t3-bold text-foreground" : "text-foreground"}
        numberOfLines={1}
      >
        {name}
      </Text>
      {status ? (
        <Text
          accessibilityLiveRegion="polite"
          textRole="footnote"
          className="text-foreground-muted"
        >
          {email ? `${status} · ${revealed ? email : "••••••@••••••"}` : status}
        </Text>
      ) : null}
    </>
  );
  if (!email) {
    return (
      <View
        accessible
        accessibilityLabel={[name, status].filter(Boolean).join(", ")}
        className="min-w-0 shrink grow gap-0.5"
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, status, revealed ? email : null].filter(Boolean).join(", ")}
      accessibilityHint={revealed ? gt("Hides the account email") : gt("Reveals the account email")}
      onPress={() => setRevealed((value) => !value)}
      className="min-w-0 shrink grow gap-0.5"
    >
      {content}
    </Pressable>
  );
}
