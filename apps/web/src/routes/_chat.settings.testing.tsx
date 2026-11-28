import { createFileRoute } from "@tanstack/react-router";

import { TestingPage } from "../components/majordome/TestingPage";

export const Route = createFileRoute("/_chat/settings/testing")({ component: TestingPage });
