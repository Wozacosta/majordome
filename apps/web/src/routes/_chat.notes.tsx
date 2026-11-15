import { createFileRoute } from "@tanstack/react-router";

import { NotesPage } from "../components/majordome/NotesPage";
import { validateNotesSearch } from "../components/majordome/notes.logic";

function NotesRoute() {
  const search = Route.useSearch();
  return <NotesPage search={search} />;
}

export const Route = createFileRoute("/_chat/notes")({
  validateSearch: validateNotesSearch,
  component: NotesRoute,
});
