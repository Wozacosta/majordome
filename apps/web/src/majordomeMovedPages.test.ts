import { isRedirect } from "@tanstack/react-router";
import { expect, it } from "vite-plus/test";

import { Route as BackupRoute } from "./routes/_chat.backup";
import { Route as NotificationsRoute } from "./routes/_chat.notifications";
import { Route as OverviewRoute } from "./routes/_chat.overview";
import { Route as PhoneRoute } from "./routes/_chat.phone";

it("sends the pages that moved into Settings to their new place", () => {
  for (const [route, to] of [
    [OverviewRoute, "/settings/overview"],
    [BackupRoute, "/settings/backup"],
    [NotificationsRoute, "/settings/notifications"],
    [PhoneRoute, "/settings/phone"],
  ] as const) {
    let thrown: unknown;
    try {
      void route.options.beforeLoad?.({} as never);
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown) ? thrown.options.to : thrown).toBe(to);
  }
});
