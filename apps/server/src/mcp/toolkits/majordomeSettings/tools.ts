import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as MajordomeSettings from "../../../majordome/MajordomeSettings.ts";
import {
  MajordomeSettingChange,
  SETTING_CHANGES_GUIDE,
} from "../../../majordome/settingsChanges.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  MajordomeSettings.MajordomeSettings,
];

const GetMajordomeStatusTool = Tool.make("get_majordome_status", {
  description:
    "Read how the Majordome app is set up for this notes folder, as its settings screens show it: the backup (where, last saved and sent, problems, sign-ins needed), the accounts each AI reaches, routines (which computer runs them, what blocks them, limits), topics, private document names, and devices that get notifications. A null part could not be read.",
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which serializes as an object schema.
  success: MajordomeSettings.MajordomeStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Check Majordome's setup")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const ChangeMajordomeSettingTool = Tool.make("change_majordome_setting", {
  description: `Make one change the owner asked for to how the Majordome app is set up for this notes folder. ${SETTING_CHANGES_GUIDE} \`message\` says what happened: done, the owner said no (tell them, don't ask again), still waiting (call again with the same \`change\`), or not possible. A \`topicId\` is the topic's \`id\` in \`get_majordome_status\`; a new topic's \`folder\` is where its notes go, such as \`projects/fitness\`. \`move_routine\` files a routine under a topic: its results arrive in that topic's conversation and the sidebar lists it there. Making or changing routines and reminders: \`schedule_task\`.`,
  parameters: Schema.Struct({ change: MajordomeSettingChange }),
  success: Schema.Struct({
    status: Schema.Literals([
      "done",
      "denied",
      "timed_out",
      "cancelled",
      "waiting",
      "not_possible",
    ]),
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Change a Majordome setting")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const MajordomeSettingsToolkit = Toolkit.make(
  GetMajordomeStatusTool,
  ChangeMajordomeSettingTool,
);
