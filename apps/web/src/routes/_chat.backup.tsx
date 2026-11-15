import { createFileRoute } from "@tanstack/react-router";

import { BackupPage } from "../components/majordome/BackupPage";

export const Route = createFileRoute("/_chat/backup")({
  component: BackupPage,
});
