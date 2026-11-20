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
  ServerProvider,
} from "@t3tools/contracts";
import * as Redacted from "effect/Redacted";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";

import { namedClipboardTarget, writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { claudeSignInFailure, claudeSignInNotes } from "./ClaudeSignInSection.logic";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsRow } from "./settingsLayout";

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "starting" }
  | { readonly kind: "link"; readonly attempt: ClaudeSignInAttempt; readonly finishing: boolean }
  | { readonly kind: "done"; readonly result: ClaudeSignInResult };

/**
 * Claude Code's full sign-in, run on the provider's machine: the link opens in this device's
 * browser and the code its page shows is pasted back, so it works on a server with no browser.
 */
export function ClaudeSignInSection({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly readOnly: boolean;
}) {
  const commands = { reportFailure: false, reportDefect: false };
  const start = useAtomCommand(serverEnvironment.startClaudeSignIn, commands);
  const submit = useAtomCommand(serverEnvironment.submitClaudeSignIn, commands);
  const cancel = useAtomCommand(serverEnvironment.cancelClaudeSignIn, commands);
  const permitted = useAtomValue(serverEnvironment.startClaudeSignIn.permissionAtom(environmentId));
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codeId = useId();

  const signedIn = provider?.auth.status === "authenticated";
  const email = provider?.auth.email?.trim();
  const unavailable = readOnly || !permitted || provider?.installed === false;

  async function begin() {
    setStep({ kind: "starting" });
    setCode("");
    setError(null);
    const result = await start({ environmentId, input: { instanceId } });
    if (result._tag === "Success") {
      setStep({ kind: "link", attempt: result.value, finishing: false });
      return;
    }
    setStep({ kind: "idle" });
    if (!isAtomCommandInterrupted(result)) {
      setError(claudeSignInFailure(squashAtomCommandFailure(result), environmentLabel).message);
    }
  }

  async function finish(attempt: ClaudeSignInAttempt) {
    const pasted = code.trim();
    if (!pasted) return;
    setStep({ kind: "link", attempt, finishing: true });
    setError(null);
    const result = await submit({
      environmentId,
      input: { instanceId, attemptId: attempt.attemptId, code: Redacted.make(pasted) },
    });
    setCode("");
    if (result._tag === "Success") {
      setStep({ kind: "done", result: result.value });
      return;
    }
    const failure = claudeSignInFailure(squashAtomCommandFailure(result), environmentLabel);
    setStep(failure.attemptOpen ? { kind: "link", attempt, finishing: false } : { kind: "idle" });
    setError(failure.message);
  }

  function stop(attempt: ClaudeSignInAttempt) {
    setStep({ kind: "idle" });
    setCode("");
    setError(null);
    void cancel({ environmentId, input: { instanceId, attemptId: attempt.attemptId } });
  }

  async function open(url: string) {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setError("Couldn't open the sign-in page. Copy the link and open it in your browser.");
    }
  }

  return (
    <SettingsRow
      title="Claude account"
      description={
        step.kind === "done" ? (
          <span role="status">
            Signed in on {environmentLabel}. Claude can now use your account's connectors there.
          </span>
        ) : signedIn && email ? (
          <span>
            Signed in as{" "}
            <RedactedSensitiveText
              key={email}
              value={email}
              ariaLabel="Toggle account email visibility"
              revealTooltip="Click to reveal email"
              hideTooltip="Click to hide email"
              className="max-w-full truncate"
            />
            . Sign in again here to bring your connectors if they are missing.
          </span>
        ) : (
          `Sign in on ${environmentLabel} with your Claude account. This brings your account's connectors (Gmail, Calendar, Drive), and works even when ${environmentLabel} has no screen.`
        )
      }
      control={
        step.kind === "done" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
            <CheckIcon className="size-3.5" />
            Signed in
          </span>
        ) : step.kind === "link" ? (
          <>
            {/* A new start replaces this attempt on the server, so the old link stops working. */}
            <Button
              size="sm"
              variant="outline"
              disabled={step.finishing}
              onClick={() => void begin()}
            >
              Start over
            </Button>
            <Button
              size="sm"
              variant="ghost-muted"
              disabled={step.finishing}
              onClick={() => stop(step.attempt)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable || step.kind === "starting"}
            onClick={() => void begin()}
          >
            {step.kind === "starting"
              ? "Getting the link…"
              : error
                ? "Start over"
                : signedIn
                  ? "Sign in again"
                  : "Sign in to Claude"}
          </Button>
        )
      }
    >
      {step.kind === "link" ? (
        <ol className="grid gap-4 py-2 text-sm leading-normal">
          <li className="grid gap-2">
            <p className="font-medium text-foreground">1. Open this link and approve</p>
            <p className="text-xs text-muted-foreground">
              It opens in your own browser, on this device. Claude then shows you a code.
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" onClick={() => void open(step.attempt.url)}>
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
                          step.attempt.url,
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
                void finish(step.attempt);
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
                    disabled={step.finishing}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
                <Button type="submit" size="sm" disabled={step.finishing || !code.trim()}>
                  {step.finishing ? "Finishing sign-in…" : "Finish sign-in"}
                </Button>
              </div>
            </form>
          </li>
        </ol>
      ) : null}
      {step.kind === "done"
        ? claudeSignInNotes(step.result).map((note) => (
            <p
              key={note.text}
              role={note.tone === "warning" ? "alert" : "status"}
              className={
                note.tone === "warning"
                  ? "py-2 text-xs text-warning-foreground"
                  : "py-2 text-xs text-muted-foreground"
              }
            >
              {note.text}
            </p>
          ))
        : null}
      {error ? (
        <p role="alert" className="py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </SettingsRow>
  );
}
