import { createFileRoute } from "@tanstack/react-router";

import { PhonePage } from "../components/majordome/PhonePage";

export const Route = createFileRoute("/_chat/phone")({
  component: PhonePage,
});
