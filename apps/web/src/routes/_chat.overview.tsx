import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into Settings; older links and bookmarks still land there.
export const Route = createFileRoute("/_chat/overview")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/overview", replace: true });
  },
});
