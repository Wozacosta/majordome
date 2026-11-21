import { Link, useLocation } from "@tanstack/react-router";
import {
  BellIcon,
  BookOpenIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  HouseIcon,
  ListTodoIcon,
  NewspaperIcon,
  NotebookTextIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildFeedRunItems } from "./feed.logic";
import { NewChatRow } from "./NewChatRow";
import { useAttention } from "./useAttention";
import { useMajordomeVaults } from "./useMajordomeVaults";

type SidebarItem = { readonly to: string; readonly label: string; readonly icon: LucideIcon };

/** The screens Majordome is used through day to day; its setup lives in Settings. */
const DAILY_ITEMS = [
  { to: "/", label: "Today", icon: HouseIcon },
  { to: "/feed", label: "Feed", icon: NewspaperIcon },
  { to: "/notes", label: "Notes", icon: NotebookTextIcon },
  { to: "/todos", label: "To-dos", icon: ListTodoIcon },
  { to: "/reading", label: "Reading list", icon: BookOpenIcon },
] as const satisfies ReadonlyArray<SidebarItem>;

/** What the assistant does without being asked each time. */
const ON_ITS_OWN_ITEMS = [
  { to: "/routines", label: "Routines", icon: CalendarClockIcon },
  { to: "/reminders", label: "Reminders", icon: BellIcon },
] as const satisfies ReadonlyArray<SidebarItem>;

type NavHint = { readonly tone: "warning" | "error"; readonly label: string };

/**
 * Majordome's own screens, named, above the thread list. `search` is the chat search field, shown
 * under the top row; `onSearch` puts the cursor in it.
 */
export function MajordomeSidebarNav({
  search,
  onSearch,
}: {
  readonly search?: ReactNode;
  readonly onSearch?: () => void;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const feedHint = useFeedHint();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  // Before there is a notes folder every screen is empty; the welcome page is the only place to be.
  const { activeVault, loading } = useMajordomeVaults();
  if (activeVault === null && !loading) return null;

  const rows = (items: ReadonlyArray<SidebarItem>) =>
    items.map(({ to, label, icon: Icon }) => {
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
    });

  return (
    <nav aria-label="Majordome" className="mb-1 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <SidebarMenu className="min-w-0 flex-1">
          <NewChatRow onOpen={closeMobileSidebar} />
        </SidebarMenu>
        {onSearch ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  variant="outline"
                  type="button"
                  aria-label="Search your chats"
                  onClick={onSearch}
                />
              }
            >
              <SearchIcon />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Search your chats</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {search}
      <SidebarMenu>{rows(DAILY_ITEMS)}</SidebarMenu>
      <div>
        <h2
          id="majordome-nav-on-its-own"
          className="flex h-7 items-center px-2 text-xs font-medium text-sidebar-muted-foreground"
        >
          Automatic
        </h2>
        <SidebarMenu aria-labelledby="majordome-nav-on-its-own">
          {rows(ON_ITS_OWN_ITEMS)}
        </SidebarMenu>
      </div>
    </nav>
  );
}

/**
 * What needs the owner, at the foot of the sidebar: the one problem and where it is fixed, or how
 * many there are and the Status page. Only there while something is wrong, so it is never a mark
 * people learn to ignore.
 */
export function MajordomeSidebarAlert() {
  const attention = useAttention();
  const { isMobile, setOpenMobile } = useSidebar();
  if (attention === null) return null;
  const failed = attention.tone === "error";
  return (
    <Link
      {...attention.link}
      data-attention={attention.tone}
      onClick={() => {
        if (isMobile) setOpenMobile(false);
      }}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-sidebar-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        failed
          ? "border-destructive/30 bg-destructive/10 hover:bg-destructive/15"
          : "border-warning/30 bg-warning/10 hover:bg-warning/15",
      )}
    >
      <CircleAlertIcon
        className={cn(
          "size-4 shrink-0",
          failed ? "text-destructive-foreground" : "text-warning-foreground",
        )}
      />
      <span role="status" className="min-w-0 flex-1 truncate font-medium">
        {attention.text}
      </span>
      <span className="shrink-0 text-sidebar-muted-foreground">Fix</span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
    </Link>
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
