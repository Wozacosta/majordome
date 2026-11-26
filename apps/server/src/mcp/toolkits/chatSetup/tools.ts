import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as MajordomeConnectors from "../../../majordome/MajordomeConnectors.ts";
import * as MajordomePrivateDocuments from "../../../majordome/MajordomePrivateDocuments.ts";
import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import * as MajordomeSkills from "../../../majordome/MajordomeSkills.ts";
import * as MajordomeTopicFiles from "../../../majordome/MajordomeTopicFiles.ts";
import * as MajordomeTopics from "../../../majordome/MajordomeTopics.ts";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const Names = Schema.Array(Schema.String);

const DescribeSetupTool = Tool.make("describe_setup", {
  description:
    "Call when the owner asks what you know, can do or have access to in this chat, or asks to see it drawn. Returns the facts: what you read before the first message (`startsWith`), the connections of this AI account (`canUse`), and what you can reach (`canReach`). Then show it with `html_render` as one diagram of three groups, in the owner's language. Draw only what is returned, plus under what you can use the kinds of tools you have yourself (browser, web search, files, routines). Names only: never a key's value or a note's text.",
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which serializes as an object schema.
  success: Schema.Struct({
    startsWith: Schema.Struct({
      instructions: Names.annotate({ description: "Standing instruction files." }),
      skills: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
      memoryNote: Schema.optionalKey(Schema.String),
      dailyNotes: Names,
      topic: Schema.optionalKey(Schema.Struct({ title: Schema.String, folder: Schema.String })),
      otherTopics: Names.annotate({
        description: "Only where each stands is loaded, not its notes.",
      }),
      otherTopicsTotal: Schema.Int,
    }),
    canUse: Schema.Struct({
      connections: Schema.optionalKey(
        Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })),
      ).annotate({ description: "Absent when this AI account cannot list them." }),
    }),
    canReach: Schema.Struct({
      computer: Schema.String,
      notesFolder: Schema.optionalKey(Schema.String),
      topicFiles: Schema.optionalKey(Names),
      topicFilesTotal: Schema.optionalKey(Schema.Int),
      savedKeys: Schema.Array(Schema.Struct({ name: Schema.String, note: Schema.String })),
      privateDocuments: Names.annotate({ description: "The owner allows each read." }),
    }),
    couldNotRead: Schema.optionalKey(Names).annotate({
      description: "Parts that failed to load: say so, don't draw them as empty.",
    }),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    FileSystem.FileSystem,
    Path.Path,
    ProjectStore.ProjectStoreV2,
    MajordomeTopics.MajordomeTopics,
    MajordomeSkills.MajordomeSkills,
    MajordomeConnectors.MajordomeConnectors,
    MajordomeTopicFiles.MajordomeTopicFiles,
    MajordomeSavedKeys.MajordomeSavedKeys,
    MajordomePrivateDocuments.MajordomePrivateDocuments,
  ],
})
  .annotate(Tool.Title, "Describe this chat's setup")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const ChatSetupToolkit = Toolkit.make(DescribeSetupTool);
