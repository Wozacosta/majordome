import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "../components/majordome/NotificationsPage";

export const Route = createFileRoute("/_chat/notifications")({
  component: NotificationsPage,
});
