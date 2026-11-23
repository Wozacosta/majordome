import type { EnvironmentId, ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";

import { Button } from "../ui/button";
import { ClaudeSignInSteps, useClaudeSignIn } from "./ClaudeSignInSection.flow";
import { claudeSignInNotes } from "./ClaudeSignInSection.logic";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingsRow } from "./settingsLayout";

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
  const signIn = useClaudeSignIn({ environmentId, environmentLabel });
  const { step, error, begin, stop } = signIn;

  const signedIn = provider?.auth.status === "authenticated";
  const email = provider?.auth.email?.trim();
  const unavailable = readOnly || !signIn.permitted || provider?.installed === false;

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
              onClick={() => void begin(instanceId)}
            >
              Start over
            </Button>
            <Button
              size="sm"
              variant="ghost-muted"
              disabled={step.finishing}
              onClick={() => stop(step)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable || step.kind === "starting"}
            onClick={() => void begin(instanceId)}
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
      {step.kind === "link" ? <ClaudeSignInSteps signIn={signIn} step={step} /> : null}
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
