import {
  MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX,
  MAJORDOME_PRIVATE_DOCUMENT_REASON_MAX,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as MajordomePrivateDocuments from "../../../majordome/MajordomePrivateDocuments.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  MajordomePrivateDocuments.MajordomePrivateDocuments,
];

const ListPrivateDocumentsTool = Tool.make("list_private_documents", {
  description:
    "List the owner's private documents (passport, tax return, contracts…) by name and description. They are encrypted outside the notes folder; this never shows what they say.",
  // No `parameters`: Tool.make defaults to Tool.EmptyParams, which serializes as an object schema.
  success: Schema.Struct({
    documents: Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List private documents")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const RequestPrivateDocumentTool = Tool.make("request_private_document", {
  description:
    "Ask the owner to let you open one private document, by its `list_private_documents` name. Only when the task truly needs what the document says. `reason` is shown to the owner: say what you will do with it. Waits for their answer. Allowed: read the temporary copy at `path`; it is deleted when your run ends or after 15 minutes. Never copy it or what it says into the notes folder unless the owner asked. Refused: tell the owner, don't ask again.",
  parameters: Schema.Struct({
    name: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX),
    ),
    reason: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAJORDOME_PRIVATE_DOCUMENT_REASON_MAX),
    ),
  }),
  success: Schema.Struct({
    status: Schema.Literals([
      "allowed",
      "denied",
      "timed_out",
      "cancelled",
      "waiting",
      "unknown_document",
    ]),
    path: Schema.optionalKey(Schema.String),
    expiresAt: Schema.optionalKey(Schema.String),
    note: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Ask to open a private document")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const PrivateDocumentsToolkit = Toolkit.make(
  ListPrivateDocumentsTool,
  RequestPrivateDocumentTool,
);
