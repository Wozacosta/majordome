import { createFileRoute } from "@tanstack/react-router";

import { PrivateDocumentsPage } from "../components/majordome/PrivateDocumentsPage";

export const Route = createFileRoute("/_chat/settings/private-documents")({
  component: PrivateDocumentsPage,
});
