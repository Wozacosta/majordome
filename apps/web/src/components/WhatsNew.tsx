import * as Schema from "effect/Schema";
import { msg, T, useGT } from "gt-react";
import { ChevronRightIcon, GiftIcon, LightbulbIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";

import { APP_VERSION } from "../branding";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { m } from "../i18n/messages";
import {
  isFirstLaunchAfterUpdate,
  notesSeenAtLaunch,
  parseWhatsNewNotes,
  splitWhatsNewInline,
  type WhatsNewGroup,
} from "../whatsNew.logic";
import { getDesktopUpdateReleaseHistoryUrl } from "./desktopUpdate.logic";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { toastManager } from "./ui/toast";

const LAST_SEEN_VERSION_KEY = "majordome:whats-new:last-seen-version";
const NOTES_SEEN_VERSION_KEY = "majordome:whats-new:notes-seen-version";
const TRY_THIS = "Try this";

const notesVersion = import.meta.env.MAJORDOME_WHATS_NEW_VERSION;
const groups = parseWhatsNewNotes(import.meta.env.MAJORDOME_WHATS_NEW_NOTES ?? "");
const earlierNotes: ReadonlyArray<{ readonly version: string; readonly notes: string }> =
  import.meta.env.MAJORDOME_WHATS_NEW_EARLIER ?? [];
const earlier = earlierNotes.map((section) => ({
  version: section.version,
  groups: parseWhatsNewNotes(section.notes),
}));

/** The version whose notes this build carries, or null when it carries none. */
export const WHATS_NEW_VERSION = notesVersion && groups.length > 0 ? notesVersion : null;

const useWhatsNew = create<{ open: boolean; unseen: boolean }>(() => ({
  open: false,
  unseen: false,
}));

let closeUpdateNotice = () => {};

export function openWhatsNew() {
  closeUpdateNotice();
  useWhatsNew.setState({ open: true, unseen: false });
  try {
    setLocalStorageItem(NOTES_SEEN_VERSION_KEY, APP_VERSION, Schema.String);
  } catch {}
}

/** Whether this version's notes have not been opened since the app was updated to it. */
export function useHasUnseenWhatsNew() {
  return useWhatsNew((state) => state.unseen);
}

let checkedThisLaunch = false;

function announceUpdateOnce() {
  if (checkedThisLaunch) return;
  checkedThisLaunch = true;
  let lastSeenVersion: string | null = null;
  try {
    lastSeenVersion = getLocalStorageItem(LAST_SEEN_VERSION_KEY, Schema.String);
    setLocalStorageItem(LAST_SEEN_VERSION_KEY, APP_VERSION, Schema.String);
    const notesSeenVersion = notesSeenAtLaunch(
      getLocalStorageItem(NOTES_SEEN_VERSION_KEY, Schema.String),
      lastSeenVersion,
      APP_VERSION,
    );
    setLocalStorageItem(NOTES_SEEN_VERSION_KEY, notesSeenVersion, Schema.String);
    if (WHATS_NEW_VERSION !== null && notesSeenVersion !== APP_VERSION) {
      useWhatsNew.setState({ unseen: true });
    }
  } catch {
    return;
  }
  if (WHATS_NEW_VERSION === null || !isFirstLaunchAfterUpdate(lastSeenVersion, APP_VERSION)) return;
  const close = () => toastManager.close(id);
  closeUpdateNotice = close;
  const id = toastManager.add({
    title: m(msg("Updated to version {version}", { version: APP_VERSION })),
    description: m(msg("See what changed and what is worth trying.")),
    timeout: 0,
    actionProps: {
      children: m(msg("See what's new")),
      onClick: openWhatsNew,
    },
    data: {
      actionLayout: "stacked-end",
      leadingIcon: <GiftIcon aria-hidden className="size-4 text-muted-foreground" />,
      secondaryActionProps: { children: m(msg("Dismiss")), onClick: close },
      secondaryActionVariant: "ghost",
    },
  });
}

function NoteText({ text }: { readonly text: string }) {
  return splitWhatsNewInline(text).map((part, index) => {
    const key = index;
    if (part.kind === "bold") return <strong key={key}>{part.text}</strong>;
    if (part.kind === "code")
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-xs" key={key}>
          {part.text}
        </code>
      );
    if (part.kind === "link")
      return (
        <a
          className="underline underline-offset-2"
          href={part.href}
          key={key}
          rel="noreferrer noopener"
          target="_blank"
        >
          {part.text}
        </a>
      );
    return part.text;
  });
}

function Notes({ groups }: { readonly groups: ReadonlyArray<WhatsNewGroup> }) {
  const tryThis = groups.find((group) => group.title === TRY_THIS);
  return (
    <div className="space-y-4">
      {tryThis ? (
        <section className="rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-3">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
            <LightbulbIcon aria-hidden className="size-4 text-primary" />
            {tryThis.title}
          </h3>
          <ul className="space-y-1.5 pl-4 text-sm leading-6">
            {tryThis.items.map((item) => (
              <li className="list-disc break-words" key={item}>
                <NoteText text={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {groups.map((group) =>
        group === tryThis ? null : (
          <section key={group.title ?? ""}>
            {group.title ? <h3 className="mb-2 text-sm font-semibold">{group.title}</h3> : null}
            <ul className="space-y-2 pl-4 text-sm leading-6 text-foreground/90">
              {group.items.map((item) => (
                <li className="list-disc break-words" key={item}>
                  <NoteText text={item} />
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

export function WhatsNewHost() {
  const gt = useGT();
  const open = useWhatsNew((state) => state.open);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the version last seen from browser storage once per launch and shows a toast
  useEffect(announceUpdateOnce, []);
  if (WHATS_NEW_VERSION === null) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => useWhatsNew.setState({ open: next })}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{gt("What's new in {version}", { version: WHATS_NEW_VERSION })}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Notes groups={groups} />
          {earlier.length > 0 ? (
            <section className="mt-6 border-t pt-4">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                <T>Earlier versions</T>
              </h3>
              {earlier.map((section) => (
                <Collapsible key={section.version}>
                  <CollapsibleTrigger className="group flex h-8 w-full items-center gap-1.5 rounded-md text-sm font-medium outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90"
                    />
                    {section.version}
                  </CollapsibleTrigger>
                  <CollapsiblePanel>
                    <div className="pt-1 pb-3 pl-5.5">
                      <Notes groups={section.groups} />
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              ))}
            </section>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            render={
              <a
                href={getDesktopUpdateReleaseHistoryUrl()}
                rel="noreferrer noopener"
                target="_blank"
              />
            }
            variant="ghost"
          >
            <T>Full changelog</T>
          </Button>
          <DialogClose render={<Button />}>
            <T>Done</T>
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
