import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type MajordomeVaultHistoryResult,
  type MajordomeVaultUndoResult,
  ThreadId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { MessageSquareIcon, NotebookPenIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useProjects } from "../../state/entities";
import { majordomeEnvironment, vaultHistoriesAtom } from "../../state/majordome";
import { formatEnvironmentQueryError } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { buildFeedItems, type FeedItem, type FeedVault, summarizeFeedFiles } from "./feed.logic";

export function FeedPage() {
  const [includeOwnChanges, setIncludeOwnChanges] = useState(true);
  const [pendingUndo, setPendingUndo] = useState<FeedItem | null>(null);
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);

  const projects = useProjects().filter((project) => !project.isScratch && !project.archivedAt);
  const results = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );

  const histories: Array<{
    vault: FeedVault;
    entries: MajordomeVaultHistoryResult["entries"];
  }> = [];
  const errors: Array<string> = [];
  let loading = false;
  projects.forEach((project, index) => {
    const result = results[index];
    if (result === undefined || result._tag === "Initial") {
      loading = true;
      return;
    }
    if (result._tag === "Failure") {
      errors.push(`${project.title}: ${formatEnvironmentQueryError(result.cause)}`);
    }
    const history = AsyncResult.getOrElse(result, () => null);
    if (history?.isVault) {
      histories.push({
        vault: {
          environmentId: project.environmentId,
          projectId: project.id,
          title: project.title,
        },
        entries: history.entries,
      });
    }
  });
  const items = buildFeedItems(histories, { includeOwnChanges });
  const showVaultName = histories.length > 1;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Feed</h1>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground [-webkit-app-region:no-drag]">
            <Switch
              size="sm"
              checked={includeOwnChanges}
              onCheckedChange={(checked) => setIncludeOwnChanges(checked)}
            />
            Show my own changes
          </label>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer>
            {errors.map((error) => (
              <p key={error} className="text-sm text-destructive-foreground">
                {error}
              </p>
            ))}
            {items.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Feed">
                {items.map((item) => (
                  <FeedRow
                    key={item.key}
                    item={item}
                    nowMs={nowMs}
                    showVaultName={showVaultName}
                    onUndo={() => setPendingUndo(item)}
                  />
                ))}
              </ul>
            ) : loading ? (
              <FeedSkeleton />
            ) : histories.length === 0 ? (
              <FeedEmpty
                title="No notes folder yet"
                description="Open your notes folder in Majordome. Everything it changes there will show up here."
              />
            ) : (
              <FeedEmpty
                title="Nothing here yet"
                description="Each time Majordome changes your notes, you'll see what it did here, and you can undo it."
              />
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      <UndoRunDialog item={pendingUndo} onClose={() => setPendingUndo(null)} />
    </SidebarInset>
  );
}

function FeedRow({
  item,
  nowMs,
  showVaultName,
  onUndo,
}: {
  readonly item: FeedItem;
  readonly nowMs: number;
  readonly showVaultName: boolean;
  readonly onUndo: () => void;
}) {
  const canUndo = useAtomValue(
    majordomeEnvironment.undoVaultRun.permissionAtom(item.vault.environmentId),
  );
  const { entry } = item;
  const files = summarizeFeedFiles(entry.files);
  const threadId = entry.threadId === null ? null : ThreadId.make(entry.threadId);
  const meta = [
    entry.byMajordome ? "Majordome" : entry.authorName,
    formatRelativeTimeLabel(entry.committedAt, nowMs),
    showVaultName ? item.vault.title : null,
  ].filter((part) => part !== null && part !== "");

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg px-3 py-2.5",
        entry.byMajordome ? "hover:bg-accent/40" : "opacity-70",
      )}
      data-feed-item={entry.commit}
    >
      <NotebookPenIcon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          entry.byMajordome ? "text-foreground/70" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              entry.byMajordome ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {item.title}
          </span>
          {item.undone ? <Badge variant="secondary">Undone</Badge> : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
        {files.shown.length > 0 ? (
          <p className="mt-1 text-xs break-words text-muted-foreground">
            {files.shown.join(", ")}
            {files.more > 0 ? ` and ${files.more} more` : ""}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {threadId !== null ? (
          <Button
            size="xs"
            variant="ghost-muted"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={buildThreadRouteParams(scopeThreadRef(item.vault.environmentId, threadId))}
              />
            }
          >
            <MessageSquareIcon />
            Open chat
          </Button>
        ) : null}
        {entry.byMajordome && !item.undone && canUndo ? (
          <Button size="xs" variant="outline" onClick={onUndo}>
            <Undo2Icon />
            Undo this
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

function FeedEmpty({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type UndoRefusal = Exclude<MajordomeVaultUndoResult, { readonly status: "undone" }>;

const REFUSAL_COPY: Record<UndoRefusal["status"], string> = {
  conflict: "Later changes touched these notes, so this can't be undone automatically.",
  "unsaved-changes": "Save or discard your edits to these notes first.",
  "not-found": "This change is no longer in your notes' history.",
};

function UndoRunDialog({
  item,
  onClose,
}: {
  readonly item: FeedItem | null;
  readonly onClose: () => void;
}) {
  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {item ? <UndoRunDialogPopup key={item.key} item={item} onClose={onClose} /> : null}
    </AlertDialog>
  );
}

function UndoRunDialogPopup({
  item,
  onClose,
}: {
  readonly item: FeedItem;
  readonly onClose: () => void;
}) {
  const undo = useAtomCommand(majordomeEnvironment.undoVaultRun, { label: "undo vault run" });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<UndoRefusal | null>(null);

  const confirm = async () => {
    setBusy(true);
    const result = await undo({
      environmentId: item.vault.environmentId,
      input: { projectId: item.vault.projectId, commit: item.entry.commit },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not undo this",
          description: error instanceof Error ? error.message : String(error),
        });
      }
      onClose();
      return;
    }
    if (result.value.status === "undone") {
      toastManager.add({ type: "success", title: "Undone", description: item.title });
      onClose();
      return;
    }
    setRefusal(result.value);
  };

  if (refusal !== null) {
    return (
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Can't undo this yet</AlertDialogTitle>
          <AlertDialogDescription>{REFUSAL_COPY[refusal.status]}</AlertDialogDescription>
          {"files" in refusal && refusal.files.length > 0 ? (
            <ul className="mt-2 list-disc ps-5 text-sm text-foreground">
              {refusal.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>OK</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    );
  }

  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Undo “{item.title}”?</AlertDialogTitle>
        <AlertDialogDescription>
          Your notes go back to how they were before this change. The undo shows up in the feed, so
          you can undo it too.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner size="sm" />}
          Undo this
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
