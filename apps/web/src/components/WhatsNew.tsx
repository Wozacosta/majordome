import * as Schema from "effect/Schema";
import { msg, T, useGT } from "gt-react";
import { GiftIcon } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";

import { APP_VERSION } from "../branding";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { m } from "../i18n/messages";
import {
  isFirstLaunchAfterUpdate,
  parseWhatsNewNotes,
  splitWhatsNewInline,
} from "../whatsNew.logic";
import { getDesktopUpdateReleaseHistoryUrl } from "./desktopUpdate.logic";
import { Button } from "./ui/button";
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

const notesVersion = import.meta.env.MAJORDOME_WHATS_NEW_VERSION;
const groups = parseWhatsNewNotes(import.meta.env.MAJORDOME_WHATS_NEW_NOTES ?? "");

/** The version whose notes this build carries, or null when it carries none. */
export const WHATS_NEW_VERSION = notesVersion && groups.length > 0 ? notesVersion : null;

const useWhatsNew = create<{ open: boolean }>(() => ({ open: false }));

export function openWhatsNew() {
  useWhatsNew.setState({ open: true });
}

let checkedThisLaunch = false;

function announceUpdateOnce() {
  if (checkedThisLaunch) return;
  checkedThisLaunch = true;
  let lastSeenVersion: string | null = null;
  try {
    lastSeenVersion = getLocalStorageItem(LAST_SEEN_VERSION_KEY, Schema.String);
    setLocalStorageItem(LAST_SEEN_VERSION_KEY, APP_VERSION, Schema.String);
  } catch {
    return;
  }
  if (WHATS_NEW_VERSION === null || !isFirstLaunchAfterUpdate(lastSeenVersion, APP_VERSION)) return;
  const close = () => toastManager.close(id);
  const id = toastManager.add({
    title: m(msg("Updated to version {version}", { version: APP_VERSION })),
    description: m(msg("See what changed and what is worth trying.")),
    timeout: 0,
    actionProps: {
      children: m(msg("See what's new")),
      onClick: () => {
        close();
        openWhatsNew();
      },
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
          {groups.map((group) => (
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
          ))}
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
            <T>Earlier versions</T>
          </Button>
          <DialogClose render={<Button />}>
            <T>Done</T>
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
