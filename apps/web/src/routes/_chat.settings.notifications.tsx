import { createFileRoute, redirect } from "@tanstack/react-router";

import { NOTIFICATIONS_ANCHOR } from "../components/majordome/phone.logic";

// Merged into "Phone & notifications"; older links, bookmarks and notifications still land there.
export const Route = createFileRoute("/_chat/settings/notifications")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/phone", hash: NOTIFICATIONS_ANCHOR, replace: true });
  },
});
