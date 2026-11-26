import { Link } from "@tanstack/react-router";
import {
  GlobeIcon,
  KeyboardIcon,
  MessageSquareTextIcon,
  MicIcon,
  PaletteIcon,
  Settings2Icon,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "../../lib/utils";
import type { SettingsPath } from "../settings/settingsSearch";

/** A setting's name, set on the part of the window it changes; it opens that setting's page. */
function Label({
  to,
  icon: Icon,
  children,
}: {
  readonly to: SettingsPath;
  readonly icon: ComponentType<{ className?: string }>;
  readonly children: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-primary/50 bg-background px-2 text-xs font-medium whitespace-nowrap text-foreground outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <Icon className="size-3.5 text-primary" aria-hidden />
      {children}
    </Link>
  );
}

/** Grey bars standing in for text nobody needs to read. */
function Lines({
  widths,
  className,
}: {
  readonly widths: ReadonlyArray<string>;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {widths.map((width, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- identical bars with no identity but their place
        <span key={index} className="h-1.5 rounded-full bg-muted-foreground/20" style={{ width }} />
      ))}
    </div>
  );
}

/**
 * The Majordome window in outline, with each setting of "This app" named on the part it changes:
 * the answer to "where would I see this?" before opening any page.
 */
export function AppWindowSketch() {
  return (
    // Below this width the three panes would be too narrow to hold their labels.
    <div className="hidden sm:block">
      <div
        role="group"
        aria-label="The Majordome window. General and Appearance change the whole window, and Keyboard shortcuts work anywhere in it. Writing messages and Voice change the message box under a chat. Browser changes the pages opened beside a chat."
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          <span aria-hidden className="flex gap-1.5 pe-2">
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
          </span>
          <Label to="/settings/general" icon={Settings2Icon}>
            General
          </Label>
          <Label to="/settings/appearance" icon={PaletteIcon}>
            Appearance
          </Label>
          <span className="ms-auto">
            <Label to="/settings/keybindings" icon={KeyboardIcon}>
              Keyboard shortcuts
            </Label>
          </span>
        </div>
        <div className="grid h-52 grid-cols-[minmax(0,2fr)_minmax(0,5fr)_minmax(0,3fr)]">
          <div className="border-e border-border bg-sidebar p-3">
            <p className="mb-3 text-2xs text-muted-foreground">Topics and chats</p>
            <Lines widths={["80%", "60%", "70%", "45%", "65%"]} />
          </div>
          <div className="flex min-w-0 flex-col p-3">
            <p className="mb-3 text-2xs text-muted-foreground">A chat</p>
            <Lines widths={["70%", "85%", "40%"]} />
            <Lines widths={["55%", "30%"]} className="mt-4 items-end" />
            <div className="mt-auto flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-2">
              <Label to="/settings/chat" icon={MessageSquareTextIcon}>
                Writing messages
              </Label>
              <span className="ms-auto">
                <Label to="/settings/voice" icon={MicIcon}>
                  Voice
                </Label>
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 border-s border-border p-3">
            <div>
              <Label to="/settings/browser" icon={GlobeIcon}>
                Browser
              </Label>
            </div>
            <p className="text-2xs text-muted-foreground">A page opened beside the chat</p>
            <Lines widths={["90%", "75%", "85%", "50%"]} />
          </div>
        </div>
      </div>
    </div>
  );
}
