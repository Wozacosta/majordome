import { createFileRoute, redirect } from "@tanstack/react-router";

import { isMajordome } from "../env";
import { IssuesPage } from "../components/issue/IssuesPage";
import { issuesSearchFromUrl } from "../components/issue/issuesSearch.logic";

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: issuesSearchFromUrl,
  // Majordome has no issues; old links and a reopened Issues view land on To-dos.
  beforeLoad: () => {
    if (isMajordome) throw redirect({ to: "/todos", replace: true });
  },
  component: IssuesPage,
});
