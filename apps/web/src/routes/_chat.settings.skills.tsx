import { createFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "../components/majordome/SkillsPage";

export const Route = createFileRoute("/_chat/settings/skills")({
  component: SkillsPage,
});
