import { useNavigate } from "@tanstack/react-router";
import { useMessages } from "gt-react";
import type { ReactNode } from "react";

import { appScreenLinkTarget } from "../majordome/assistant.logic";

/** `label` is the link's written text; an autolink has none, and takes the screen's own name. */
export function MarkdownAppScreenLink(props: {
  readonly href: string;
  readonly label: ReactNode | null;
}) {
  const m = useMessages();
  const navigate = useNavigate();
  const screen = appScreenLinkTarget(props.href);
  // A screen this app does not have still reads as the words written for it.
  if (screen === null) return <span>{props.label ?? props.href}</span>;
  return (
    <a
      href={screen.to}
      data-app-screen-link={screen.to}
      // The address is the app's own route, which a new tab or window would not open.
      onAuxClick={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        void navigate({ to: screen.to });
      }}
    >
      {props.label ?? m(screen.label)}
    </a>
  );
}
