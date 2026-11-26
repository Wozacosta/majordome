import { BookOpenIcon, BugIcon, CircleHelpIcon, GiftIcon } from "lucide-react";

import { APP_VERSION } from "../../branding";
import { readLocalApi } from "../../localApi";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { openWhatsNew, useHasUnseenWhatsNew, WHATS_NEW_VERSION } from "../WhatsNew";
import { GUIDES_URL, problemReportUrl } from "./help.logic";

function openOutside(url: string) {
  void readLocalApi()
    ?.shell.openExternal(url)
    .catch(() => undefined);
}

export function openGuides() {
  openOutside(GUIDES_URL);
}

export function reportProblem() {
  openOutside(
    problemReportUrl(APP_VERSION, {
      userAgent: navigator.userAgent,
      desktopApp: window.desktopBridge !== undefined,
      homeScreen: window.matchMedia("(display-mode: standalone)").matches,
    }),
  );
}

/**
 * The "?" at the foot of the sidebar: what changed in this version, the guides, and where a
 * problem is reported. It carries a dot until the notes of a new version have been opened.
 */
export function HelpMenu({ side }: { readonly side: "right" | "top" }) {
  const unseen = useHasUnseenWhatsNew();
  const { isMobile, setOpenMobile } = useSidebar();
  const leave = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <SidebarMenuItem className="shrink-0">
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    type="button"
                    aria-label={unseen ? "Help, new version" : "Help"}
                    className="relative"
                  />
                }
              />
            }
          >
            <CircleHelpIcon />
            {unseen ? (
              <span
                aria-hidden
                data-unseen-notes
                className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-sidebar"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side={side}>Help</TooltipPopup>
        </Tooltip>
        <MenuPopup side={side} align={side === "right" ? "end" : "start"} className="min-w-48">
          {WHATS_NEW_VERSION === null ? null : (
            <MenuItem
              onClick={() => {
                leave();
                openWhatsNew();
              }}
            >
              <GiftIcon />
              <span className="flex-1">What's new</span>
              {unseen ? <span aria-hidden className="size-2 rounded-full bg-primary" /> : null}
            </MenuItem>
          )}
          <MenuItem onClick={openGuides}>
            <BookOpenIcon />
            Guides
          </MenuItem>
          <MenuItem onClick={reportProblem}>
            <BugIcon />
            Report a problem
          </MenuItem>
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}
