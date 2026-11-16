import { useAtomValue } from "@effect/atom-react";
import { Link, useLocation } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import {
  CalendarClockIcon,
  CircleAlertIcon,
  HouseIcon,
  NewspaperIcon,
  NotebookTextIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { vaultBackupStatusesAtom } from "../../state/majordome";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { backupAttention } from "./backup.logic";
import { buildFeedRunItems } from "./feed.logic";

/** The screens Majordome is used through; its setup lives in Settings. */
const MAJORDOME_SIDEBAR_ITEMS = [
  { to: "/", label: "Today", icon: HouseIcon },
  { to: "/feed", label: "Feed", icon: NewspaperIcon },
  { to: "/notes", label: "Notes", icon: NotebookTextIcon },
  { to: "/settings/scheduled-tasks", label: "Routines", icon: CalendarClockIcon },
] as const satisfies ReadonlyArray<{ to: string; label: string; icon: LucideIcon }>;

type NavHint = { readonly tone: "warning" | "error"; readonly label: string };

/** Majordome's own screens, named, above the thread list. */
export function MajordomeSidebarNav() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const feedHint = useFeedHint();
  const backupAlert = useBackupAlert();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <nav aria-label="Majordome" className="mt-1">
      <SidebarMenu>
        {MAJORDOME_SIDEBAR_ITEMS.map(({ to, label, icon: Icon }) => {
          const hint = to === "/feed" ? feedHint : null;
          return (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                isActive={pathname === to}
                aria-current={pathname === to ? "page" : undefined}
                render={<Link to={to} />}
                onClick={closeMobileSidebar}
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
        {/* Only there while something is wrong, so it is never a mark people learn to ignore. */}
        {backupAlert ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/settings/backup" />}
              onClick={closeMobileSidebar}
              data-backup-alert
            >
              <CircleAlertIcon className="text-warning-foreground" />
              <span role="status" className="min-w-0 flex-1 truncate text-warning-foreground">
                {backupAlert}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
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

/** What is wrong with saving or a chosen backup of any vault, or null when all is well. */
function useBackupAlert(): string | null {
  const projects = useVaultProjects();
  const results = useAtomValue(
    vaultBackupStatusesAtom(
      JSON.stringify(projects.map((project) => [project.environmentId, project.id])),
    ),
  );
  for (const result of results) {
    const status = AsyncResult.getOrElse(result, () => null);
    const alert = status?.isVault === true ? backupAttention(status) : null;
    if (alert !== null) return alert;
  }
  return null;
}
