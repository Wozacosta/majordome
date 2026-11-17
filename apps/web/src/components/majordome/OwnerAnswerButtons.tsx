import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/**
 * The two answers to a card only the owner can answer. `answer` resolves to what went wrong, in
 * the owner's words, or null once the answer was taken.
 */
export function OwnerAnswerButtons({
  allowLabel,
  answer,
}: {
  readonly allowLabel: string;
  readonly answer: (allow: boolean) => Promise<string | null>;
}) {
  const [sending, setSending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two taps can both land before a render.
  const inFlight = useRef(false);

  const send = async (allow: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(allow ? "allow" : "deny");
    setError(null);
    const problem = await answer(allow).finally(() => {
      inFlight.current = false;
      setSending(null);
    });
    setError(problem);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={sending !== null} onClick={() => void send(true)}>
          {sending === "allow" ? <Spinner size="sm" /> : null}
          {allowLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={sending !== null}
          onClick={() => void send(false)}
        >
          {sending === "deny" ? <Spinner size="sm" /> : null}
          Don't allow
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
