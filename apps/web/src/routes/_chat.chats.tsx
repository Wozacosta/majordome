import { createFileRoute } from "@tanstack/react-router";

import { ChatsPage } from "../components/majordome/ChatsPage";

export const Route = createFileRoute("/_chat/chats")({
  component: ChatsPage,
});
