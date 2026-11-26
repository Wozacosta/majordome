import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsGuidePage } from "../components/majordome/SettingsGuidePage";
import type { SettingsGuideTopic } from "../components/settings/settingsSearch";
import { isMajordome } from "../env";

const TOPICS: ReadonlyArray<string> = [
  "app",
  "notes",
  "ai",
  "devices",
] satisfies ReadonlyArray<SettingsGuideTopic>;

function GuideRoute() {
  const { topic } = Route.useParams();
  return <SettingsGuidePage topic={topic as SettingsGuideTopic} />;
}

export const Route = createFileRoute("/_chat/settings/guide/$topic")({
  beforeLoad: ({ params }) => {
    // Only Majordome has these pages, and only for the parts it explains.
    if (!isMajordome || !TOPICS.includes(params.topic)) {
      throw redirect({ to: "/settings", replace: true });
    }
  },
  component: GuideRoute,
});
