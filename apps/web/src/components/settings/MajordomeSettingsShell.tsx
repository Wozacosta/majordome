import { Navigate, useLocation, useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { AppRouteModalClose } from "../AppRouteModal";
import { HEADING_CLASS } from "../majordome/paper";
import { Button } from "../ui/button";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

/** Below Tailwind's `md`, where Settings shows one thing at a time. */
export const MAJORDOME_SETTINGS_PHONE_QUERY = "(max-width: 767px)";

const SETTINGS_LIST_PATH = "/settings";
const SETTINGS_FIRST_PAGE = "/settings/overview";

/**
 * Majordome's Settings inside its modal. On a wide screen the list of pages sits beside the open
 * page. On a phone `/settings` is the list, a page fills the screen, and back returns to the list.
 */
export function MajordomeSettingsShell({
  actions,
  children,
}: {
  /** Controls beside the close button. */
  readonly actions?: ReactNode;
  /** The open page. */
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const phone = useMediaQuery(MAJORDOME_SETTINGS_PHONE_QUERY);
  const contentArea = workspaceAreaProps("settings", 1, gt("Settings content"));
  const atList = pathname.replace(/\/+$/, "") === SETTINGS_LIST_PATH;

  // A wide screen has no list-only view, so a window widened on the list opens the first page.
  if (atList && !phone) return <Navigate to={SETTINGS_FIRST_PAGE} replace />;

  if (atList) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between ps-5 pe-2">
          <h1 className={cn(HEADING_CLASS, "text-xl")}>{gt("Settings")}</h1>
          <AppRouteModalClose />
        </header>
        <SettingsSidebarNav pathname={pathname} variant="list" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      {phone ? null : <SettingsSidebarNav pathname={pathname} />}
      <div {...contentArea} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-1 px-2">
          {phone ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigate({
                  to: SETTINGS_LIST_PATH,
                  hash: "",
                  replace: true,
                  hashScrollIntoView: false,
                })
              }
            >
              <ChevronLeftIcon />
              {gt("Settings")}
            </Button>
          ) : null}
          <div className="ms-auto flex shrink-0 items-center gap-1">
            {actions}
            <AppRouteModalClose />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
