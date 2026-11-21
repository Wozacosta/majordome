import { createFileRoute } from "@tanstack/react-router";

import { ReadingListPage } from "../components/majordome/ReadingListPage";

export const Route = createFileRoute("/_chat/reading")({
  component: ReadingListPage,
});
