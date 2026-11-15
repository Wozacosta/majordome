import { createFileRoute, redirect } from "@tanstack/react-router";

// Moved into Settings; older links and bookmarks still land there.
export const Route = createFileRoute("/_chat/backup")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/backup", replace: true });
  },
});
