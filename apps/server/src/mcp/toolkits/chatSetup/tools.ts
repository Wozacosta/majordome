import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import { CHAT_SETUP_WORDS } from "../../../majordome/chatSetupPage.ts";
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
  description: `Call when the owner asks what you know, can do or have access to in this chat, or asks to see it drawn. Returns the facts and \`page\`, a map of them already drawn: show it by passing \`page\`'s path, title and height to \`html_render\`, unchanged. Don't draw your own.`,
  parameters: Schema.Struct({
    tools: Schema.optionalKey(
      Schema.Array(Schema.String.check(Schema.isMaxLength(40))).check(Schema.isMaxLength(12)),
    ).annotate({
      description:
        "Your own kinds of tools, two words each, in the owner's language: Browser, Web search, Files.",
    }),
    words: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)).annotate({
      description: `Only when the chat is not in English: the page's words, each English one mapped to the owner's language. ${CHAT_SETUP_WORDS.join("; ")}.`,
    }),
  }),
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
      description: "Parts that failed to load: say so, they are not empty.",
    }),
    page: Schema.Struct({ path: Schema.String, title: Schema.String, height: Schema.Int }),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    ServerConfig.ServerConfig,
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
