import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { CircleAlertIcon, CloudUploadIcon } from "lucide-react";

import { majordomeEnvironment } from "../../state/majordome";
import { cn } from "../../lib/utils";
import { backupHeadline } from "./backup.logic";
import type { FeedVault } from "./feed.logic";

/** The feed's one line about a vault's backup, linking to "Back up my brain". */
export function BackupStatusLine({
  vault,
  showVaultName,
}: {
  readonly vault: FeedVault;
  readonly showVaultName: boolean;
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
      className="flex min-h-7 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground hover:bg-accent/40"
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
        {showVaultName ? `${vault.title}: ` : ""}
        {headline.title}
      </span>
    </Link>
  );
}
