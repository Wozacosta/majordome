import { ArrowLeftIcon, MessageCircleIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { RoutinesAssistant } from "./RoutinesAssistant";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";
import { useVaultRoutines } from "./useVaultRoutines";

const HINT = "Ask for help, or say what you'd like set up or changed.";

/**
 * A page with the assistant on its right. Where there is no room for both, the page comes first
 * and a button opens the assistant over it.
 */
export function AssistantDock({
  children,
  /** The conversation already on screen elsewhere, which must not be mounted twice. */
  shownThreadId = null,
  className,
}: {
  readonly children: ReactNode;
  /** The height of the area the dock fills. */
  readonly className: string;
  readonly shownThreadId?: string | null;
}) {
  const { activeVault } = useMajordomeVaults();
  const [open, setOpen] = useState(false);
  // The page keeps its place in the tree whatever the assistant does, so it never remounts.
  return (
    <div className={cn("@container/assistant relative flex min-h-0 min-w-0 flex-1", className)}>
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 @5xl/assistant:flex",
          open && activeVault !== null ? "hidden" : "flex",
        )}
      >
        {children}
      </div>
      {activeVault === null ? null : (
        <VaultAssistant
          key={activeVault.key}
          vault={activeVault}
          shownThreadId={shownThreadId}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}

function VaultAssistant({
  vault,
  shownThreadId,
  open,
  onOpenChange,
}: {
  readonly vault: MajordomeVault;
  readonly shownThreadId: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { runner } = useVaultRoutines(vault);
  if (
    runner === null ||
    (runner.routinesThreadId !== null && runner.routinesThreadId === shownThreadId)
  ) {
    return null;
  }
  return (
    <>
      {open ? null : (
        <div className="absolute end-4 bottom-4 z-10 @5xl/assistant:hidden">
          <Button size="sm" onClick={() => onOpenChange(true)}>
            <MessageCircleIcon />
            Assistant
          </Button>
        </div>
      )}
      <aside
        className={cn(
          "h-full min-h-0 min-w-0 flex-1 flex-col bg-background @5xl/assistant:flex @5xl/assistant:max-w-md @5xl/assistant:border-l @5xl/assistant:border-border",
          open ? "flex" : "hidden",
        )}
      >
        <RoutinesAssistant
          key={`${runner.environmentId}:${runner.projectId}`}
          copy={runner}
          title="Assistant"
          hint={HINT}
          back={
            <span className="@5xl/assistant:hidden">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Back to the page"
                onClick={() => onOpenChange(false)}
              >
                <ArrowLeftIcon />
              </Button>
            </span>
          }
        />
      </aside>
    </>
  );
}
