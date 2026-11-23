import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowUpIcon, FolderIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

const withoutEndSlash = (folder: string) => folder.replace(/(?<=.)\/+$/, "");

/**
 * Picks a folder on the server's computer by walking its folders, for a browser, which has no
 * folder picker of its own. Starts in the home folder.
 */
export function FolderBrowser({
  environmentId,
  disabled,
  onUse,
  label = "Choose folder",
  forNotes = false,
}: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly onUse: (folder: string) => void;
  readonly label?: string;
  /** The folder becomes the notes themselves: it stays open while they start, and the home folder is questioned. */
  readonly forNotes?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("~/");
  const listing = useEnvironmentQuery(
    open ? filesystemEnvironment.browse({ environmentId, input: { partialPath: path } }) : null,
  );
  // The last folder that opened stays on screen while the next one loads or fails to open.
  const [shown, setShown] = useState(listing.data);
  const [home, setHome] = useState<string | null>(null);
  const [confirmingHome, setConfirmingHome] = useState(false);
  if (listing.data !== null && listing.data !== shown) {
    setShown(listing.data);
    if (path === "~/") setHome(withoutEndSlash(listing.data.parentPath));
  }
  const here = shown?.parentPath ?? null;
  const folders = (shown?.entries ?? []).filter((entry) => !entry.name.startsWith("."));
  const parent = here === null ? null : here.replace(/[^/]+\/?$/, "");
  const loading = open && listing.data === null && listing.error === null;
  const nameOf = (folder: string) => withoutEndSlash(folder).split("/").pop() ?? "";
  const hereName = here === null ? "" : nameOf(here);
  const go = (next: string) => {
    setConfirmingHome(false);
    if (next === path) listing.refresh();
    else setPath(next);
  };

  if (!open) {
    return (
      <div className="mt-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
          {label}
        </Button>
      </div>
    );
  }
  const use = (folder: string) => {
    if (!forNotes) setOpen(false);
    onUse(folder);
  };
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/70">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="Up one folder"
          disabled={parent === null || parent === "" || parent === here}
          onClick={() => parent && go(parent)}
        >
          <ArrowUpIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {here === null ? (listing.error === null ? "Looking…" : "") : shortFolder(here)}
        </span>
        {loading ? <Spinner size="xs" tone="muted" /> : null}
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => {
            setConfirmingHome(false);
            setOpen(false);
          }}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          disabled={disabled || here === null || loading || confirmingHome}
          onClick={() => {
            if (here === null) return;
            if (forNotes && withoutEndSlash(here) === home) setConfirmingHome(true);
            else use(withoutEndSlash(here));
          }}
        >
          {hereName === "" ? "Use this folder" : `Use “${hereName}”`}
        </Button>
      </div>
      {confirmingHome && here !== null ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
          <p className="min-w-0 flex-1 basis-64 text-xs leading-relaxed text-foreground">
            This is your whole home folder. Everything in it would count as your notes. A folder
            inside it is usually the better choice.
          </p>
          <Button size="xs" variant="outline" onClick={() => setConfirmingHome(false)}>
            Pick another
          </Button>
          <Button size="xs" variant="outline" disabled={disabled} onClick={() => use(here)}>
            Use my home folder
          </Button>
        </div>
      ) : null}
      {listing.error === null ? null : (
        <p role="alert" className="border-b border-border/60 px-3 py-1.5 text-xs text-destructive">
          {nameOf(path) === "" || path === "~/"
            ? "This folder could not be opened."
            : `“${nameOf(path)}” could not be opened.`}
        </p>
      )}
      <ul
        aria-label="Folders here"
        aria-busy={loading}
        className={cn("max-h-56 overflow-y-auto py-1", loading && "opacity-60")}
      >
        {folders.map((entry) => (
          <li key={entry.fullPath}>
            <button
              type="button"
              disabled={loading}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
              onClick={() => go(`${entry.fullPath}/`)}
            >
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </button>
          </li>
        ))}
        {shown !== null && folders.length === 0 ? (
          <li className="px-3 py-1 text-xs leading-relaxed text-muted-foreground">
            No folders to show here. If you expected some, Majordome may not be allowed to look
            inside this one.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** The last two folders of a path, which is the part that tells folders apart. */
function shortFolder(folder: string): string {
  const parts = folder.split("/").filter((part) => part !== "");
  return parts.length <= 2 ? folder : `…/${parts.slice(-2).join("/")}`;
}

/**
 * One button to pick a folder on the computer the notes are on: its own folder window in the
 * desktop app when that computer is this one, otherwise a walk through its folders.
 */
export function ChooseFolder({
  environmentId,
  onThisComputer,
  disabled,
  label,
  onChoose,
}: {
  readonly environmentId: EnvironmentId;
  readonly onThisComputer: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChoose: (folder: string) => void;
}) {
  if (onThisComputer && typeof window !== "undefined" && window.desktopBridge !== undefined) {
    const pick = async () => {
      const picked = await ensureLocalApi().dialogs.pickFolder();
      if (picked) onChoose(picked);
    };
    return (
      <div className="mt-2">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void pick()}>
          {label}
        </Button>
      </div>
    );
  }
  return (
    <FolderBrowser
      environmentId={environmentId}
      disabled={disabled}
      label={label}
      onUse={onChoose}
    />
  );
}
