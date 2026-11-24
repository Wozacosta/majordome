import { hidesCodingTools } from "@t3tools/shared/majordome";

import { FeedbackToolkit } from "../mcp/toolkits/feedback/tools.ts";
import { IssuesToolkit } from "../mcp/toolkits/issues/tools.ts";
import { PullRequestsToolkit } from "../mcp/toolkits/pullRequests/tools.ts";
import { WorkflowToolkit } from "../mcp/toolkits/workflow/tools.ts";
import { WorktreeToolkit } from "../mcp/toolkits/worktree/tools.ts";

/** Coding tools a notes assistant never needs; a fifth of what every chat would be told. */
const HIDDEN_TOOL_NAMES: ReadonlySet<string> = new Set(
  // Feedback goes to T3 Code's own team, and workflows are its coding automation.
  [PullRequestsToolkit, IssuesToolkit, WorktreeToolkit, FeedbackToolkit, WorkflowToolkit].flatMap(
    (toolkit) => Object.keys(toolkit.tools),
  ),
);

/**
 * Upstream's coding toolkits stay registered, so a merge never conflicts on them. They are only
 * left out of the list the assistant reads; a call to one still runs.
 */
export const isListed = (method: string, target: string): boolean =>
  !hidesCodingTools || method !== "tools/list" || !HIDDEN_TOOL_NAMES.has(target);
