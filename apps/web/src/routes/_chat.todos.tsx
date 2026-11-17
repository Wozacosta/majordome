import { createFileRoute } from "@tanstack/react-router";

import { TodosPage } from "../components/majordome/TodosPage";

export const Route = createFileRoute("/_chat/todos")({
  component: TodosPage,
});
