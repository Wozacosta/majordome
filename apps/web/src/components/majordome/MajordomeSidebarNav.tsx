import { useAtomValue } from "@effect/atom-react";
import { Link, useLocation } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  CalendarClockIcon,
  CloudUploadIcon,
  NewspaperIcon,
  SmartphoneIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { vaultBackupStatusesAtom } from "../../state/majordome";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { backupHeadline } from "./backup.logic";
import { buildFeedRunItems } from "./feed.logic";

type NavPath = "/feed" | "/settings/scheduled-tasks" | "/backup" | "/phone";

const NAV_ITEMS: ReadonlyArray<{ to: NavPath; label: string; icon: LucideIcon }> = [
  { to: "/feed", label: "Feed", icon: NewspaperIcon },
  { to: "/settings/scheduled-tasks", label: "Routines", icon: CalendarClockIcon },
  { to: "/backup", label: "Back up my brain", icon: CloudUploadIcon },
  { to: "/phone", label: "Your phone", icon: SmartphoneIcon },
];

type NavHint = { readonly tone: "warning" | "error"; readonly label: string };

/** Majordome's own screens, named, above the thread list. */
export function MajordomeSidebarNav() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const feedHint = useFeedHint();
  const backupHint = useBackupHint();
  const hints: Partial<Record<NavPath, NavHint | null>> = {
    "/feed": feedHint,
    "/backup": backupHint,
  };

  return (
    <nav aria-label="Majordome" className="mt-1">
      <SidebarMenu>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
          const hint = hints[to];
          return (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                isActive={pathname === to}
                aria-current={pathname === to ? "page" : undefined}
                render={<Link to={to} />}
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <Icon />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {hint ? (
                  <span
                    role="status"
                    aria-label={hint.label}
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      hint.tone === "error" ? "bg-destructive" : "bg-warning",
                    )}
                  />
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </nav>
  );
}

function useVaultProjects() {
  return useProjects().filter((project) => !project.isScratch && !project.archivedAt);
}

/** A dot on Feed when a run waits for the person or couldn't finish. */
function useFeedHint(): NavHint | null {
  const threads = useQuietThreadShells();
  const vaults = useVaultProjects().map((project) => ({
    environmentId: project.environmentId,
    projectId: project.id,
    title: project.title,
  }));
  const runs = buildFeedRunItems(threads, vaults);
  if (runs.some((run) => run.status === "waiting")) {
    return { tone: "warning", label: "A run is waiting for you" };
  }
  if (runs.length > 0) return { tone: "error", label: "A run couldn't finish" };
  return null;
}

/** A dot on "Back up my brain" when saving or backing up is paused or failing. */
function useBackupHint(): NavHint | null {
  const projects = useVaultProjects();
  const results = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  const needsAttention = results.some((result) => {
    const status = AsyncResult.getOrElse(result, () => null);
    return status?.isVault === true && backupHeadline(status).tone === "warning";
  });
  return needsAttention ? { tone: "warning", label: "Backup needs your attention" } : null;
}
