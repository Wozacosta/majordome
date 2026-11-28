import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";

import { isWebUrl } from "../../browser/webUrl";
import { namedClipboardTarget, writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { geminiSetupStep, geminiSignInStep } from "../../onboarding/welcomePage.logic";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderAuthenticationSection } from "../settings/ProviderAuthenticationSection";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

const COMMANDS = { reportFailure: false, reportDefect: false };

/** Runs one command at a time and keeps what went wrong, in the computer's own words. */
function useSetupCommand() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (command: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setPending(true);
    setError(null);
    const result = await command();
    setPending(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "That did not work. Try again.");
    }
    return false;
  };
  return { pending, error, setError, run };
}

/** Gemini's setup on the welcome page: the download, then the sign-in with a link and a code. */
export function GeminiSetup({
  environmentId,
  environmentLabel,
  name,
  provider,
  settings,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  /** What the row above calls this AI. */
  readonly name: string;
  readonly provider: ServerProvider;
  readonly settings: ServerSettings;
  readonly onClose: () => void;
}) {
  const { instanceId } = provider;
  const target = { environmentId, input: { instanceId } };
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const installQuery = useEnvironmentQuery(serverEnvironment.providerInstallState(target));
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, COMMANDS);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, COMMANDS);
  const { pending, error, run } = useSetupCommand();
  const install = installQuery.data;
  const step = geminiSetupStep({ provider, settings, install });
  const problem =
    error ?? installQuery.error ?? (step === "installFailed" ? install?.message : null);

  return (
    <div
      ref={(node) => node?.scrollIntoView({ block: "nearest" })}
      className="my-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs text-foreground"
    >
      {step === "signIn" ? (
        <GeminiSignIn
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          name={name}
          provider={provider}
          readOnly={!canManage}
        />
      ) : (
        <div className="flex min-h-8 items-center gap-2">
          <p role="status" className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
            {step === "checking" || step === "installing" ? (
              <Spinner size="xs" className="shrink-0" />
            ) : null}
            {step === "installing"
              ? install?.phase === "downloading" && install.downloadedBytes > 0
                ? `Downloading, ${Math.round(install.downloadedBytes / 1_000_000)} MB so far…`
                : "Installing, about a minute…"
              : step === "checking"
                ? "Checking…"
                : step === "done"
                  ? "Signed in."
                  : "Not on this computer yet."}
          </p>
          {step === "installing" && install?.operationId ? (
            <Button
              size="xs"
              variant="ghost-muted"
              disabled={pending}
              onClick={() => {
                const operationId = install.operationId;
                if (operationId === null) return;
                void run(() =>
                  cancelInstall({ environmentId, input: { instanceId, operationId } }),
                );
              }}
            >
              Cancel
            </Button>
          ) : step === "install" || step === "installFailed" ? (
            <Button
              size="xs"
              variant="outline"
              aria-label={`Install: ${name}`}
              disabled={pending || !canManage}
              onClick={() => void run(() => startInstall(target))}
            >
              {step === "installFailed" ? "Try again" : "Install"}
            </Button>
          ) : null}
        </div>
      )}
      {problem ? (
        <p role="alert" className="py-1 text-destructive [overflow-wrap:anywhere]">
          {problem}
        </p>
      ) : null}
      {step === "installing" ? null : (
        <div className="flex justify-end">
          <Button size="xs" variant="ghost-muted" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

/** A Google account's sign-in: a link to open, then the code Google's last page shows. */
function GeminiSignIn({
  environmentId,
  environmentLabel,
  name,
  provider,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly name: string;
  readonly provider: ServerProvider;
  readonly readOnly: boolean;
}) {
  const { instanceId } = provider;
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target));
  const start = useAtomCommand(serverEnvironment.startProviderAuth, COMMANDS);
  const respond = useAtomCommand(serverEnvironment.respondProviderAuth, COMMANDS);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, COMMANDS);
  const { pending, error, setError, run } = useSetupCommand();
  const [code, setCode] = useState("");
  const codeId = useId();
  const step = geminiSignInStep({ provider, auth: authQuery.data });

  if (step.kind === "other") {
    return (
      <ProviderAuthenticationSection
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        provider={provider}
        readOnly={readOnly}
      />
    );
  }

  const problem = error ?? authQuery.error ?? (step.kind === "start" ? step.problem : null);
  const open = async (url: string) => {
    const opened =
      isWebUrl(url) &&
      (await ensureLocalApi()
        .shell.openExternal(url)
        .then(
          () => true,
          () => false,
        ));
    if (!opened) {
      setError("Couldn't open the sign-in page. Copy the link and open it in your browser.");
    }
  };

  return (
    <>
      {step.kind === "code" ? (
        <ol className="grid gap-4 py-2 text-sm leading-normal">
          <li className="grid gap-2">
            <p className="font-medium text-foreground">1. Open this link and approve</p>
            <p className="text-xs text-muted-foreground">Google then shows you a code.</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" disabled={readOnly} onClick={() => void open(step.url)}>
                Open Google sign-in
                <ExternalLinkIcon className="size-3.5" />
              </Button>
              <Button
                aria-label="Copy sign-in link"
                size="icon-sm"
                variant="ghost-muted"
                onClick={() =>
                  void writeTextToClipboard(
                    step.url,
                    namedClipboardTarget("Google sign-in link"),
                  ).catch(() => setError("Couldn't copy the sign-in link."))
                }
              >
                <CopyIcon />
              </Button>
              <Button
                size="sm"
                variant="ghost-muted"
                disabled={pending}
                onClick={() =>
                  void run(() =>
                    cancel({ environmentId, input: { instanceId, flowId: step.flowId } }),
                  )
                }
              >
                Start over
              </Button>
            </div>
          </li>
          <li>
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const pasted = code.trim();
                if (pasted === "") return;
                void run(() =>
                  respond({
                    environmentId,
                    input: {
                      instanceId,
                      flowId: step.flowId,
                      interactionId: step.interactionId,
                      response: { type: "credentials", values: { [step.field]: pasted } },
                    },
                  }),
                ).then((sent) => {
                  if (sent) setCode("");
                });
              }}
            >
              <label htmlFor={codeId} className="font-medium text-foreground">
                2. Paste the code here
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Input
                    id={codeId}
                    size="sm"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={code}
                    maxLength={16_384}
                    disabled={pending || readOnly}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
                <Button type="submit" size="sm" disabled={pending || readOnly || !code.trim()}>
                  {pending ? "Finishing sign-in…" : "Finish sign-in"}
                </Button>
              </div>
            </form>
          </li>
        </ol>
      ) : (
        <div className="flex min-h-8 items-center gap-2">
          <p role="status" className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
            {step.kind === "start" ? null : <Spinner size="xs" className="shrink-0" />}
            {step.kind === "starting"
              ? "Getting your sign-in link…"
              : step.kind === "verifying"
                ? "Checking your account…"
                : step.kind === "checking"
                  ? "Checking…"
                  : "Sign in with your Google account."}
          </p>
          {step.kind === "start" ? (
            <Button
              size="xs"
              variant="outline"
              aria-label={`Sign in: ${name}`}
              disabled={pending || readOnly}
              onClick={() => void run(() => start(target))}
            >
              {step.problem === null ? "Sign in" : "Try again"}
            </Button>
          ) : null}
        </div>
      )}
      {problem ? (
        <p role="alert" className="py-1 text-destructive [overflow-wrap:anywhere]">
          {problem}
        </p>
      ) : null}
    </>
  );
}
