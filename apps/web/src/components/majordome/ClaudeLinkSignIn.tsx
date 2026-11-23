import type { ProviderInstanceId } from "@t3tools/contracts";

import { type ClaudeSignIn, ClaudeSignInSteps } from "../settings/ClaudeSignInSection.flow";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/** Claude's sign-in as a link to open and a code to paste, for a server with no screen. */
export function ClaudeLinkSignIn({
  signIn,
  instanceId,
  onClose,
}: {
  readonly signIn: ClaudeSignIn;
  readonly instanceId: ProviderInstanceId;
  readonly onClose: () => void;
}) {
  const { step, error } = signIn;
  return (
    <div
      ref={(node) => node?.scrollIntoView({ block: "nearest" })}
      className="my-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-foreground"
    >
      {step.kind === "link" ? (
        <ClaudeSignInSteps signIn={signIn} step={step} />
      ) : (
        <p role="status" className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          {step.kind === "starting" ? <Spinner size="xs" className="shrink-0" /> : null}
          {step.kind === "starting"
            ? "Getting your sign-in link…"
            : step.kind === "done"
              ? "Signed in. Claude says Ready above in a moment."
              : "Sign-in did not start."}
        </p>
      )}
      {error ? (
        <p role="alert" className="py-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-1">
        {step.kind === "idle" ? (
          <Button size="xs" variant="ghost" onClick={() => void signIn.begin(instanceId)}>
            Start over
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => {
            if (step.kind === "link") signIn.stop(step);
            onClose();
          }}
        >
          {step.kind === "done" ? "Close" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
