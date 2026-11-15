import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into Settings; older links and bookmarks still land there.
export const Route = createFileRoute("/_chat/phone")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/phone", replace: true });
  },
});
