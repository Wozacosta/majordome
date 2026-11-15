import { createFileRoute } from "@tanstack/react-router";

import { FeedPage } from "../components/majordome/FeedPage";

export const Route = createFileRoute("/_chat/feed")({
  component: FeedPage,
});
