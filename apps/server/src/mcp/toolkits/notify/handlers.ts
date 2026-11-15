import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as AgentNotify from "../../../majordome/AgentNotify.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { NotifyToolkit } from "./tools.ts";

const sentMessage = (sentTo: number) =>
  sentTo === 0
    ? "No device has notifications turned on. The user can turn them on in Notifications."
    : `Sent to ${sentTo} ${sentTo === 1 ? "device" : "devices"}.`;

const handlers = {
  notify_me: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "notify_me");
      const sentTo = yield* (yield* AgentNotify.AgentNotify)
        .notify({ threadId: thread.threadId, title: input.title, message: input.message })
        .pipe(
          Effect.catchTags({
            AgentNotifyTooSoonError: ({ retryAfterSeconds }) =>
              Effect.fail(
                new OrchestratorMcpFailure({
                  code: "invalid_request",
                  message: `Not sent: this thread sent one moments ago. Wait ${retryAfterSeconds}s, or put everything in one notification.`,
                }),
              ),
          }),
        );
      return { sentTo, message: sentMessage(sentTo) };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof NotifyToolkit.tools>;

export const layer = McpToolAccess.toLayer(NotifyToolkit, handlers);
