import { createFileRoute } from "@tanstack/react-router";

import { RemindersPage } from "../components/majordome/RemindersPage";

export const Route = createFileRoute("/_chat/reminders")({
  component: RemindersPage,
});
