import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/majordome/AccountPage";

export const Route = createFileRoute("/_chat/settings/account")({
  component: AccountPage,
});
