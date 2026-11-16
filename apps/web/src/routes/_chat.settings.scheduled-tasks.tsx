import { createFileRoute, redirect } from "@tanstack/react-router";

import { isMajordome } from "../env";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";

import { ScheduledTasksSettings } from "../components/settings/ScheduledTasksSettings";

function SettingsScheduledTasksRoute() {
  const target = Route.useSearch();
  return <ScheduledTasksSettings {...target} />;
}

export const Route = createFileRoute("/_chat/settings/scheduled-tasks")({
  validateSearch: validateScheduledTasksSearch,
  // Majordome's routines have their own screen; links to a task from a conversation land there.
  beforeLoad: () => {
    if (isMajordome) throw redirect({ to: "/routines", replace: true });
  },
  component: SettingsScheduledTasksRoute,
});
