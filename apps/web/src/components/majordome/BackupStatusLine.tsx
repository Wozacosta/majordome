import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { CircleAlertIcon, CloudUploadIcon } from "lucide-react";

import { majordomeEnvironment } from "../../state/majordome";
import { cn } from "../../lib/utils";
import { backupHeadline } from "./backup.logic";
import type { FeedVault } from "./feed.logic";
import { ROW_ACTION_CLASS } from "./paper";

/** The feed's one line about a vault's backup, linking to "Back up my brain". */
export function BackupStatusLine({
  vault,
  label,
}: {
  readonly vault: FeedVault;
  /** The brain or machine the line is about, when several are listed. */
  readonly label: string | null;
}) {
  const result = useAtomValue(
    majordomeEnvironment.backupStatus({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId },
    }),
  );
  const status = AsyncResult.getOrElse(result, () => null);
  if (status === null || !status.isVault) return null;
  const headline = backupHeadline(status);
  const Icon = headline.tone === "warning" ? CircleAlertIcon : CloudUploadIcon;
  return (
    <Link
      to="/settings/backup"
      className={cn(
        ROW_ACTION_CLASS,
        "flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground",
      )}
      data-backup-line={headline.tone}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          headline.tone === "warning" && "text-warning-foreground",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        {label === null ? "" : `${label}: `}
        {headline.title}
      </span>
    </Link>
  );
}
