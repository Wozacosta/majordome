import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Suspense, useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { MermaidDiagram } from "../chat/MermaidDiagram";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const note = (text: string, tone: "quiet" | "problem" = "quiet") => (
  <p
    className={
      tone === "problem"
        ? "text-center text-sm text-destructive"
        : "text-center text-sm text-muted-foreground"
    }
  >
    {text}
  </p>
);

/**
 * "Draw it": the conversation as a small diagram, drawn by the owner's AI when they ask. The last
 * drawing is kept by the server, so opening it again costs nothing until "Draw again".
 */
export function DrawConversationButton({
  environmentId,
  threadId,
  saved,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The drawing made last time, if there was one. */
  readonly saved: string | null;
}) {
  const canDraw = useAtomValue(majordomeEnvironment.drawConversation.permissionAtom(environmentId));
  const drawConversation = useAtomCommand(majordomeEnvironment.drawConversation, {
    label: "draw conversation",
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drawing = drawn ?? saved;

  const draw = async () => {
    setBusy(true);
    setFailure(null);
    const outcome = await drawConversation({ environmentId, input: { threadId } });
    setBusy(false);
    if (outcome._tag === "Success") {
      setDrawn(outcome.value.diagram);
    } else if (!isAtomCommandInterrupted(outcome)) {
      const error = squashAtomCommandFailure(outcome);
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  if (!canDraw) return null;
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          setOpen(true);
          setFailure(null);
          if (drawing === null && !busy) void draw();
        }}
      >
        Draw it
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>This chat, drawn</DialogTitle>
            <DialogDescription>
              Made by your AI from the latest messages. Each drawing is one small request to your AI
              plan.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex min-h-48 flex-col justify-center">
              {busy ? (
                note("Drawing…")
              ) : failure !== null ? (
                note(failure, "problem")
              ) : drawing === null ? null : (
                <RenderErrorBoundary
                  resetKeys={[drawing]}
                  fallback={note("This drawing could not be shown. Draw it again.", "problem")}
                >
                  <Suspense fallback={note("Drawing…")}>
                    <MermaidDiagram
                      source={drawing}
                      onExpand={(imageUrl) => window.open(imageUrl, "_blank", "noopener")}
                    />
                  </Suspense>
                </RenderErrorBoundary>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => void draw()}>
              {failure !== null ? "Try again" : "Draw again"}
            </Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
