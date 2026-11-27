import { createFileRoute } from "@tanstack/react-router";

import { AlwaysOnServerPage } from "../components/majordome/AlwaysOnServerPage";
import { isServerWay } from "../components/majordome/serverWays.logic";

export const Route = createFileRoute("/_chat/settings/always-on")({
  validateSearch: (raw: Record<string, unknown>) => (isServerWay(raw.add) ? { add: raw.add } : {}),
  component: AlwaysOnServerPage,
});
