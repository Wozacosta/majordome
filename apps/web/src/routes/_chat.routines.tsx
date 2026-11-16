import { createFileRoute } from "@tanstack/react-router";

import { RoutinesPage } from "../components/majordome/RoutinesPage";

export const Route = createFileRoute("/_chat/routines")({
  component: RoutinesPage,
});
