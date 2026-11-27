import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ClaudeSignInAttempt,
  ClaudeSignInResult,
  EnvironmentId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";

import { namedClipboardTarget, writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { claudeSignInFailure } from "@t3tools/shared/claudeSignIn";

export type ClaudeSignInStep =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | {
      readonly kind: "link";
      readonly instanceId: ProviderInstanceId;
      readonly attempt: ClaudeSignInAttempt;
      readonly finishing: boolean;
    }
  | { readonly kind: "done"; readonly result: ClaudeSignInResult };

/**
 * Claude Code's full sign-in, run on the provider's machine: the link opens in this device's
 * browser and the code its page shows is pasted back, so it works on a server with no browser.
 */
export function useClaudeSignIn({
  environmentId,
  environmentLabel,
  onSignedIn,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onSignedIn?: (instanceId: ProviderInstanceId) => void;
}) {
  const commands = { reportFailure: false, reportDefect: false };
  const start = useAtomCommand(serverEnvironment.startClaudeSignIn, commands);
  const submit = useAtomCommand(serverEnvironment.submitClaudeSignIn, commands);
  const cancel = useAtomCommand(serverEnvironment.cancelClaudeSignIn, commands);
  const permitted = useAtomValue(serverEnvironment.startClaudeSignIn.permissionAtom(environmentId));
  const [step, setStep] = useState<ClaudeSignInStep>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function begin(instanceId: ProviderInstanceId) {
    setStep({ kind: "starting" });
    setCode("");
    setError(null);
    const result = await start({ environmentId, input: { instanceId } });
    if (result._tag === "Success") {
      setStep({ kind: "link", instanceId, attempt: result.value, finishing: false });
      return;
    }
    setStep({ kind: "idle" });
    if (!isAtomCommandInterrupted(result)) {
      setError(claudeSignInFailure(squashAtomCommandFailure(result), environmentLabel).message);
    }
  }

  async function finish(open: Extract<ClaudeSignInStep, { kind: "link" }>) {
    const { instanceId, attempt } = open;
    const pasted = code.trim();
    if (!pasted) return;
    setStep({ ...open, finishing: true });
    setError(null);
    const result = await submit({
      environmentId,
      input: { instanceId, attemptId: attempt.attemptId, code: Redacted.make(pasted) },
    });
    setCode("");
    if (result._tag === "Success") {
      setStep({ kind: "done", result: result.value });
      onSignedIn?.(instanceId);
      return;
    }
    const failure = claudeSignInFailure(squashAtomCommandFailure(result), environmentLabel);
    setStep(failure.attemptOpen ? { ...open, finishing: false } : { kind: "idle" });
    setError(failure.message);
  }

  function stop(open: Extract<ClaudeSignInStep, { kind: "link" }>) {
    setStep({ kind: "idle" });
    setCode("");
    setError(null);
    void cancel({
      environmentId,
      input: { instanceId: open.instanceId, attemptId: open.attempt.attemptId },
    });
  }

  async function open(url: string) {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setError("Couldn't open the sign-in page. Copy the link and open it in your browser.");
    }
  }

  return { step, code, setCode, error, setError, permitted, begin, finish, stop, open };
}

export type ClaudeSignIn = ReturnType<typeof useClaudeSignIn>;

/** The two steps of an open attempt: open the link, then paste the code Claude shows. */
export function ClaudeSignInSteps({
  signIn,
  step,
}: {
  readonly signIn: ClaudeSignIn;
  readonly step: Extract<ClaudeSignInStep, { kind: "link" }>;
}) {
  const { attempt, finishing } = step;
  const codeId = useId();
  const { code, setCode, setError } = signIn;
  return (
    <ol className="grid gap-4 py-2 text-sm leading-normal">
      <li className="grid gap-2">
        <p className="font-medium text-foreground">1. Open this link and approve</p>
        <p className="text-xs text-muted-foreground">
          It opens in your own browser, on this device. Claude then shows you a code.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => void signIn.open(attempt.url)}>
            Open Claude sign-in
            <ExternalLinkIcon className="size-3.5" />
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Copy sign-in link"
                  size="icon-sm"
                  variant="ghost-muted"
                  onClick={() =>
                    void writeTextToClipboard(
                      attempt.url,
                      namedClipboardTarget("Claude sign-in link"),
                    ).catch(() => setError("Couldn't copy the sign-in link."))
                  }
                >
                  <CopyIcon />
                </Button>
              }
            />
            <TooltipPopup>Copy sign-in link</TooltipPopup>
          </Tooltip>
        </div>
      </li>
      <li>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn.finish(step);
          }}
        >
          <label htmlFor={codeId} className="font-medium text-foreground">
            2. Paste the code here
          </label>
          <p className="text-xs text-muted-foreground">
            The code only works for a few minutes, so paste it straight away.
          </p>
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
                placeholder="Paste the code from Claude"
                value={code}
                maxLength={4_096}
                disabled={finishing}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button type="submit" size="sm" disabled={finishing || !code.trim()}>
              {finishing ? "Finishing sign-in…" : "Finish sign-in"}
            </Button>
          </div>
        </form>
      </li>
    </ol>
  );
}
