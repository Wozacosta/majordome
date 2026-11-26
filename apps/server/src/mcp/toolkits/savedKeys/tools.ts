import {
  MAJORDOME_SAVED_KEY_NOTE_MAX,
  MAJORDOME_SAVED_KEY_VALUE_MAX,
  MajordomeSavedKeyDay,
  MajordomeSavedKeyName,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  ServerEnvironment.ServerEnvironment,
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  MajordomeSavedKeys.MajordomeSavedKeys,
];

const ListSavedKeysTool = Tool.make("list_saved_keys", {
  description:
    "List the API keys, tokens and passwords the owner saved for you on this computer, by name with what each is for. Check here before you say you cannot reach a service, and before you ask for a key. Never shows a value.",
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which serializes as an object schema.
  success: Schema.Struct({
    keys: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        note: Schema.String,
        expires: Schema.optional(Schema.String).annotate({
          description: "The last day the owner said it works.",
        }),
      }),
    ),
    note: Schema.optional(Schema.String).annotate({
      description:
        "Set when no key is saved here: which computer this is, and what to tell the owner.",
    }),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List saved keys")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const UseSavedKeyTool = Tool.make("use_saved_key", {
  description:
    'Take one saved key for a command, by its `list_saved_keys` name. Returns `file`: read it only inside the command that needs it, e.g. `curl -H "Authorization: Bearer $(cat <file>)" <url>`. Never print the key, say it in chat or write it in the notes folder.',
  parameters: Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)) }),
  success: Schema.Struct({
    status: Schema.Literals(["ready", "unknown_key"]),
    file: Schema.optional(Schema.String),
    note: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Use a saved key")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const SaveKeyTool = Tool.make("save_key", {
  description:
    'Save an API key, token or password the owner gives you, so later chats can use it with `use_saved_key`. `name`: short, e.g. `garmin`. `note`: what it is for. The owner pasted it in chat: pass `value`. Otherwise get it with `request_secret` (`delivery: "file"`) and pass that `file`. Replaces a key with the same name. `expires`: its last day, when the owner or the service says how long it lasts; with no `value` or `file`, sets that day on a key already saved. Never write a key in the notes folder instead.',
  parameters: Schema.Struct({
    name: MajordomeSavedKeyName,
    note: Schema.String.check(Schema.isMaxLength(MAJORDOME_SAVED_KEY_NOTE_MAX)),
    value: Schema.optional(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAJORDOME_SAVED_KEY_VALUE_MAX)),
    ),
    file: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    expires: Schema.optional(MajordomeSavedKeyDay).annotate({ description: "YYYY-MM-DD" }),
  }),
  success: Schema.Struct({ status: Schema.Literal("saved"), note: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Save a key")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const SavedKeysToolkit = Toolkit.make(ListSavedKeysTool, UseSavedKeyTool, SaveKeyTool);
