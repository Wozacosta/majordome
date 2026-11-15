import { createFileRoute } from "@tanstack/react-router";

import { OverviewPage } from "../components/majordome/OverviewPage";

export const Route = createFileRoute("/_chat/settings/overview")({
  component: OverviewPage,
});
