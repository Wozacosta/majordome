import { type MajordomePrivateDocumentError, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MajordomePrivateDocuments from "../../../majordome/MajordomePrivateDocuments.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PrivateDocumentsToolkit } from "./tools.ts";

/** What the agent reads with each answer. Model-facing: evals/mcp-tool-use covers it. */
export const PRIVATE_DOCUMENT_REQUEST_NOTES = {
  allowed:
    "Read the file at `path`. It is deleted when this run ends or at `expiresAt`. Don't copy it or what it says into the notes folder unless the owner asked.",
  denied:
    "The owner said no. Tell them what you could not do and go on without the document. Don't ask again or look for it another way.",
  timed_out:
    "The owner did not answer in time, so the request was denied. Say what is blocked; ask again only if they tell you to.",
  cancelled: "The request closed before an answer. Ask again only if the document is still needed.",
  waiting:
    "The owner has not answered yet. The request stays open for 24 hours: call again with the same `name` to keep waiting.",
} as const;

const toFailure = (error: MajordomePrivateDocumentError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "agent_stopped" ? "parent_not_active" : "orchestration_error",
    message: error.message,
  });

const handlers = {
  list_private_documents: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { documents } = yield* (yield* MajordomePrivateDocuments.MajordomePrivateDocuments)
        .list()
        .pipe(Effect.mapError(toFailure));
      return {
        documents: documents.map(({ name, description }) => ({ name, description })),
      };
    }),
  ),
  request_private_document: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "request_private_document",
      );
      const result = yield* (yield* MajordomePrivateDocuments.MajordomePrivateDocuments)
        .request({ threadId: thread.threadId, name: input.name, reason: input.reason })
        .pipe(Effect.mapError(toFailure));
      switch (result.status) {
        case "allowed":
          return { ...result, note: PRIVATE_DOCUMENT_REQUEST_NOTES.allowed };
        case "unknown_document":
          return {
            status: result.status,
            note:
              result.available.length === 0
                ? "The owner has no private documents. They add them in Settings, Private documents."
                : `No private document has that name. Names: ${result.available.join("; ")}.`,
          };
        default:
          return { status: result.status, note: PRIVATE_DOCUMENT_REQUEST_NOTES[result.status] };
      }
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PrivateDocumentsToolkit.tools>;

export const layer = McpToolAccess.toLayer(PrivateDocumentsToolkit, handlers);
