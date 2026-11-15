import { createFileRoute } from "@tanstack/react-router";

import { AlwaysOnServerPage } from "../components/majordome/AlwaysOnServerPage";

export const Route = createFileRoute("/_chat/settings/always-on")({
  component: AlwaysOnServerPage,
});
