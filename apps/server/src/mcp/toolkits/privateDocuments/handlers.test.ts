import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MajordomePrivateDocumentError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as MajordomePrivateDocuments from "../../../majordome/MajordomePrivateDocuments.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as PrivateDocumentsHandlers from "./handlers.ts";
import { PrivateDocumentsToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:visa");

it.effect("tells the agent names only, and what each answer to a request means for it", () =>
  Effect.gen(function* () {
    const asked: Array<{ readonly threadId: ThreadId; readonly name: string }> = [];
    let next: MajordomePrivateDocuments.PrivateDocumentRequestResult | "stopped" = {
      status: "allowed",
      path: "/state/attachments/private-documents-open/abc/passport.pdf",
      expiresAt: "2026-11-16T10:15:00.000Z",
    };
    const layerDependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment:home"),
        requestNamespace: "provider:visa",
        thread: {
          threadId,
          providerSessionId: "provider:visa",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      }),
      Layer.mock(MajordomePrivateDocuments.MajordomePrivateDocuments)({
        list: () =>
          Effect.succeed({
            documents: [
              {
                id: "0123456789abcdef0123456789abcdef",
                name: "Passport",
                description: "Scan of my passport",
                fileName: "passport.pdf",
                mediaType: "application/pdf",
                sizeBytes: 1024,
                addedAt: "2026-11-01T09:00:00.000Z",
              },
            ],
            accessLog: [],
          }),
        request: (input) => {
          asked.push({ threadId: input.threadId, name: input.name });
          return next === "stopped"
            ? Effect.fail(new MajordomePrivateDocumentError({ reason: "agent_stopped" }))
            : Effect.succeed(next);
        },
      }),
    );
    yield* Effect.gen(function* () {
      const toolkit = yield* PrivateDocumentsToolkit;
      const result = <Name extends "list_private_documents" | "request_private_document">(
        name: Name,
        params: Parameters<typeof toolkit.handle<Name>>[1],
      ) =>
        toolkit.handle(name, params).pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );
      const ask = result("request_private_document", { name: "Passport", reason: "Visa form." });

      expect(yield* result("list_private_documents", {})).toEqual({
        documents: [{ name: "Passport", description: "Scan of my passport" }],
      });

      expect(yield* ask).toEqual({
        status: "allowed",
        path: "/state/attachments/private-documents-open/abc/passport.pdf",
        expiresAt: "2026-11-16T10:15:00.000Z",
        note: PrivateDocumentsHandlers.PRIVATE_DOCUMENT_REQUEST_NOTES.allowed,
      });
      expect(asked).toEqual([{ threadId, name: "Passport" }]);

      next = { status: "denied" };
      expect(yield* ask).toEqual({
        status: "denied",
        note: PrivateDocumentsHandlers.PRIVATE_DOCUMENT_REQUEST_NOTES.denied,
      });

      next = { status: "unknown_document", available: ["Passport", "Tax return 2025"] };
      expect(yield* ask).toEqual({
        status: "unknown_document",
        note: "No private document has that name. Names: Passport; Tax return 2025.",
      });

      next = "stopped";
      expect(yield* ask).toMatchObject({ code: "parent_not_active" });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(PrivateDocumentsHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
