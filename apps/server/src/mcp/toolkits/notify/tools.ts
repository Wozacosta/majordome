import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as AgentNotify from "../../../majordome/AgentNotify.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const NotifyMeTool = Tool.make("notify_me", {
  description:
    "Send a push notification to the user's phone and other devices that opens this thread. Only when the user explicitly asked to be notified. Keep it short.",
  parameters: Schema.Struct({
    title: Schema.optionalKey(
      Schema.String.check(Schema.isMaxLength(AgentNotify.AGENT_NOTIFY_TITLE_MAX)),
    ),
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(AgentNotify.AGENT_NOTIFY_MESSAGE_MAX),
    ),
  }),
  success: Schema.Struct({ sentTo: Schema.Number, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    AgentNotify.AgentNotify,
  ],
})
  .annotate(Tool.Title, "Notify the user")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const NotifyToolkit = Toolkit.make(NotifyMeTool);
