import { useNavigate } from "@tanstack/react-router";
import { useMessages } from "gt-react";
import type { ReactNode } from "react";

import { appScreenLinkTarget, namedScreenTarget } from "../majordome/assistant.logic";

/** `label` is the link's written text; an autolink has none, and takes the screen's own name. */
export function MarkdownAppScreenLink(props: {
  readonly href: string;
  readonly label: ReactNode | null;
}) {
  const m = useMessages();
  const screen = appScreenLinkTarget(props.href);
  // A screen this app does not have still reads as the words written for it.
  if (screen === null) return <span>{props.label ?? props.href}</span>;
  return <ScreenLink to={screen.to}>{props.label ?? m(screen.label)}</ScreenLink>;
}

/** A screen's name in bold, linked where `message`, the whole message, means that screen. */
export function MarkdownNamedScreen(props: {
  readonly name: string;
  readonly message: string;
  readonly children: ReactNode;
}) {
  const m = useMessages();
  const screen = namedScreenTarget(props.name, props.message, m);
  return screen === null ? (
    props.children
  ) : (
    <ScreenLink to={screen.to}>{props.children}</ScreenLink>
  );
}

function ScreenLink(props: {
  readonly to: NonNullable<ReturnType<typeof appScreenLinkTarget>>["to"];
  readonly children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={props.to}
      data-app-screen-link={props.to}
      // The address is the app's own route, which a new tab or window would not open.
      onAuxClick={(event) => event.preventDefault()}
      onClick={(event) => {
        event.preventDefault();
        void navigate({ to: props.to });
      }}
    >
      {props.children}
    </a>
  );
}
