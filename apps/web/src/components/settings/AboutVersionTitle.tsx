import { useNavigate } from "@tanstack/react-router";
import { msg, T, useGT } from "gt-react";
import { useRef } from "react";

import { APP_VERSION } from "../../branding";
import { isMajordome } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const HOLD_MS = 700;

export function AboutVersionTitle() {
  const gt = useGT();
  const navigate = useNavigate();
  // Holding the version opens Testing, as on the phone. It is in no list on purpose.
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endHold = () => {
    if (hold.current !== null) clearTimeout(hold.current);
    hold.current = null;
  };
  const startHold = () => {
    endHold();
    if (!isMajordome) return;
    hold.current = setTimeout(() => void navigate({ to: "/settings/testing" }), HOLD_MS);
  };
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: {
      target: "version",
      unavailableMessage: msg("Clipboard API is unavailable while copying version."),
      failureMessage: msg("Failed to copy version to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy version"),
          description: error.message,
        }),
      );
    },
  });

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>
        <T>Version</T>
      </span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                tone="muted"
                aria-label={gt("Copy version {version}", { version: APP_VERSION })}
                onClick={() => copyToClipboard(APP_VERSION, undefined)}
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
              >
                {APP_VERSION}
              </InlineButton>
            }
          />
          <TooltipPopup>
            <T>Copy version</T>
          </TooltipPopup>
        </Tooltip>
      </code>
    </span>
  );
}
