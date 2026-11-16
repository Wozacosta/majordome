import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsPage } from "../components/majordome/ConnectionsPage";

export const Route = createFileRoute("/_chat/settings/connectors")({
  component: ConnectionsPage,
});
