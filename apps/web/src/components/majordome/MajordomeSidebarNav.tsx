import { Link, useLocation } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  BellIcon,
  BookOpenIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  HistoryIcon,
  HouseIcon,
  LibraryIcon,
  ListTodoIcon,
  NotebookTextIcon,
  PinIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import { useState, type ReactNode } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FEED_NAME } from "./feed.logic";
import { NewChatRow } from "./NewChatRow";
import { useAttention } from "./useAttention";
import { useMajordomeVaults } from "./useMajordomeVaults";

type Page = { readonly to: string; readonly label: string; readonly icon: LucideIcon };

/** The screens Majordome is used through day to day; its setup lives in Settings. */
const PAGES = [
  { to: "/", label: "Today", icon: HouseIcon },
  { to: "/notes", label: "Notes", icon: NotebookTextIcon },
  { to: "/todos", label: "To-dos", icon: ListTodoIcon },
  { to: "/reading", label: "Reading list", icon: BookOpenIcon },
  { to: "/library", label: "Library", icon: LibraryIcon },
  { to: "/routines", label: "Routines", icon: CalendarClockIcon },
  { to: "/reminders", label: "Reminders", icon: BellIcon },
  { to: "/feed", label: FEED_NAME, icon: HistoryIcon },
] as const satisfies ReadonlyArray<Page>;

const PINNED_PAGES_KEY = "majordome:sidebar-pinned-pages";
const PinnedPages = Schema.Array(Schema.String);
/** What is looked at every day; the rest waits under More until someone pins it. */
const DEFAULT_PINNED_PAGES: ReadonlyArray<string> = [
  "/",
  "/notes",
  "/todos",
  "/reading",
  "/routines",
];

type Layout = "rail" | "row";

/**
 * Majordome's pages as icons: the pinned ones, then More, which lists every page and pins or
 * unpins it. A rail down the side of the sidebar, or a row across the top of it on a phone.
 */
function PageIcons({ layout }: { readonly layout: Layout }) {
  const gt = useGT();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const [pinned, setPinned] = useLocalStorage(PINNED_PAGES_KEY, DEFAULT_PINNED_PAGES, PinnedPages);
  const [moreOpen, setMoreOpen] = useState(false);
  const leave = () => {
    setMoreOpen(false);
    if (isMobile) setOpenMobile(false);
  };
  const size = layout === "rail" ? "icon" : "iconWide";
  const tooltipSide = layout === "rail" ? "right" : "bottom";
  const itemClassName = layout === "rail" ? "shrink-0" : "flex-1";
  const pinnedPages = PAGES.filter((page) => pinned.includes(page.to));
  // An open page that is not pinned is under More, so More is where it shows.
  const openPageIsUnderMore = PAGES.some(
    (page) => page.to === pathname && !pinned.includes(page.to),
  );

  return (
    <>
      {pinnedPages.map(({ to, label, icon: Icon }) => (
        <SidebarMenuItem key={to} className={itemClassName}>
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuButton
                  size={size}
                  isActive={pathname === to}
                  aria-current={pathname === to ? "page" : undefined}
                  aria-label={label}
                  render={<Link to={to} />}
                  onClick={leave}
                />
              }
            >
              <Icon />
            </TooltipTrigger>
            <TooltipPopup side={tooltipSide}>{label}</TooltipPopup>
          </Tooltip>
        </SidebarMenuItem>
      ))}
      <SidebarMenuItem className={itemClassName}>
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <SidebarMenuButton
                      size={size}
                      type="button"
                      isActive={openPageIsUnderMore}
                      aria-label={gt("More", { $context: "opens the list of every page" })}
                    />
                  }
                />
              }
            >
              <EllipsisIcon />
            </TooltipTrigger>
            <TooltipPopup side={tooltipSide}>
              {gt("More", { $context: "opens the list of every page" })}
            </TooltipPopup>
          </Tooltip>
          <PopoverPopup
            side={layout === "rail" ? "right" : "bottom"}
            align={layout === "rail" ? "start" : "end"}
            padding="none"
            width="auto"
          >
            <ul className="flex min-w-52 flex-col gap-px p-1">
              {PAGES.map(({ to, label, icon: Icon }) => {
                const isPinned = pinned.includes(to);
                return (
                  <li key={to} className="flex items-center gap-1">
                    <Link
                      to={to}
                      aria-current={pathname === to ? "page" : undefined}
                      onClick={leave}
                      className={cn(
                        "flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        pathname === to && "bg-accent font-medium",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                    </Link>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-pressed={isPinned}
                      aria-label={
                        isPinned
                          ? gt("Unpin {name}", { name: label })
                          : gt("Pin {name}", { name: label })
                      }
                      onClick={() =>
                        setPinned(isPinned ? pinned.filter((page) => page !== to) : [...pinned, to])
                      }
                    >
                      <PinIcon
                        className={cn(
                          "size-4",
                          isPinned ? "fill-current" : "text-muted-foreground/60",
                        )}
                      />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </PopoverPopup>
        </Popover>
      </SidebarMenuItem>
    </>
  );
}

/**
 * The narrow rail down the left of the sidebar: the pinned pages and More at the top, and at the
 * foot what `footer` holds, such as Settings.
 */
export function MajordomePageRail({ footer }: { readonly footer: ReactNode }) {
  // Before there is a notes folder every screen is empty; the welcome page is the only place to be.
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2 py-2 ps-2 pe-1">
      <nav
        aria-label="Majordome"
        className="min-h-0 w-full flex-1 overflow-y-auto [scrollbar-width:none]"
      >
        {activeVault === null && !loading ? null : (
          <SidebarMenu className="items-center">
            <PageIcons layout="rail" />
          </SidebarMenu>
        )}
      </nav>
      <SidebarMenu className="items-center">{footer}</SidebarMenu>
    </div>
  );
}

/**
 * The top of the chat list: a new chat and the chat search. `search` is the search field, shown
 * under the top row; `onSearch` puts the cursor in it. A phone has no rail, so its pages go here.
 */
export function MajordomeSidebarNav({
  search,
  onSearch,
}: {
  readonly search?: ReactNode;
  readonly onSearch?: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { activeVault, loading } = useMajordomeVaults();
  if (activeVault === null && !loading) return null;

  return (
    <div className="mb-1 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <SidebarMenu className="min-w-0 flex-1">
          <NewChatRow
            onOpen={() => {
              if (isMobile) setOpenMobile(false);
            }}
          />
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
      {isMobile ? (
        <nav aria-label="Majordome">
          <SidebarMenu className="mt-1.5 flex-row items-center">
            <PageIcons layout="row" />
          </SidebarMenu>
        </nav>
      ) : null}
    </div>
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
      <span className="shrink-0 text-sidebar-muted-foreground">{attention.action}</span>
      <ChevronRightIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
    </Link>
  );
}
