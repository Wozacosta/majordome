import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  MajordomePrivateDocumentError,
  type MajordomePrivateDocumentsResult,
  type MajordomeTopicFilesResult,
  ProviderDriverKind,
  type ProviderConnector,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as MajordomeConnectors from "../../../majordome/MajordomeConnectors.ts";
import * as MajordomePrivateDocuments from "../../../majordome/MajordomePrivateDocuments.ts";
import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import { layerSavedKeysForTest } from "../../../majordome/MajordomeSavedKeys.testkit.ts";
import * as MajordomeSkills from "../../../majordome/MajordomeSkills.ts";
import * as MajordomeTopicFiles from "../../../majordome/MajordomeTopicFiles.ts";
import * as MajordomeTopics from "../../../majordome/MajordomeTopics.ts";
import { localIsoDate, readChatKnowledge } from "../../../majordome/vaultContext.ts";
import { readVaultSkills } from "../../../majordome/vaultSkills.ts";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as ChatSetupHandlers from "./handlers.ts";
import { ChatSetupToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:accounting");
const shell = liveThreadShell(threadId);

const layerAgent = Layer.mergeAll(
  Layer.succeed(McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment:home"),
    requestNamespace: "provider:accounting",
    thread: {
      threadId,
      providerSessionId: "provider:accounting",
      providerInstanceId: shell.providerInstanceId,
    },
    client: undefined,
    capabilities: new Set(["orchestration" as const]),
    issuedAt: 0,
  }),
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: () => Effect.succeed(shell),
  }),
  Layer.mock(ServerEnvironment.ServerEnvironment)({
    getDescriptor: Effect.succeed({ label: "Home Mac" } as ExecutionEnvironmentDescriptor),
  }),
);

const describe = Effect.gen(function* () {
  const toolkit = yield* ChatSetupToolkit;
  return yield* toolkit.handle("describe_setup", {}).pipe(
    Stream.unwrap,
    Stream.runCollect,
    Effect.map((parts) => parts.at(-1)?.result),
  );
});

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nSteps.\n`;

const write = Effect.fn("test.write")(function* (root: string, files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = `${root}/${relativePath}`;
    yield* fs.makeDirectory(filePath.slice(0, filePath.lastIndexOf("/")), { recursive: true });
    yield* fs.writeFileString(filePath, contents);
  }
});

/**
 * The notes, skills and keys are the real ones on disk, read the way a chat's start reads them.
 * Only what needs a running server is stood in for: the AI account's connections, the topic's
 * files and the private documents.
 */
const layerSetup = Effect.fn("test.layerSetup")(function* (input: {
  readonly notes: string;
  readonly stateDir: string;
  readonly connectors?: ReadonlyArray<ProviderConnector> | undefined;
  readonly privateDocuments: Effect.Effect<
    MajordomePrivateDocumentsResult,
    MajordomePrivateDocumentError
  >;
}) {
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  return Layer.mergeAll(
    layerAgent,
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () => Effect.succeedSome({ workspaceRoot: input.notes } as ProjectStore.ProjectRow),
    }),
    Layer.mock(MajordomeTopics.MajordomeTopics)({
      chatKnowledge: (asked) =>
        Effect.gen(function* () {
          return yield* readChatKnowledge({
            vaultRoot: input.notes,
            nowMillis: DateTime.toEpochMillis(yield* DateTime.now),
            topicOf: { threadId: asked.threadId, stateDir: input.stateDir },
          });
        }).pipe(Effect.provide(services), Effect.orDie),
    }),
    Layer.mock(MajordomeSkills.MajordomeSkills)({
      list: () =>
        readVaultSkills(input.notes).pipe(
          Effect.map((skills) => ({ isVault: true, ...skills })),
          Effect.provide(services),
          Effect.orDie,
        ),
    }),
    Layer.mock(MajordomeConnectors.MajordomeConnectors)({
      list: () =>
        Effect.succeed({
          checkedAt: "2026-11-26T10:00:00.000Z",
          providers: [
            {
              instanceId: ProviderInstanceId.make("someone-else"),
              driver: ProviderDriverKind.make("claudeAgent"),
              reported: true,
              connectors: [{ name: "Not this chat's", status: "connected" as const }],
            },
            {
              instanceId: shell.providerInstanceId,
              driver: ProviderDriverKind.make("codex"),
              reported: input.connectors !== undefined,
              connectors: input.connectors ?? [],
            },
          ],
        }),
    }),
    Layer.mock(MajordomeTopicFiles.MajordomeTopicFiles)({
      list: () =>
        Effect.succeed({
          files: [{ name: "invoice-march.pdf" }],
          total: 14,
          large: false,
        } as unknown as MajordomeTopicFilesResult),
    }),
    Layer.mock(MajordomePrivateDocuments.MajordomePrivateDocuments)({
      list: () => input.privateDocuments,
    }),
  );
});

const layerHandlers = McpToolAccess.HandlersLayer.layer(ChatSetupHandlers.layer);

it.layer(NodeServices.layer)("describe_setup", (it) => {
  it.effect(
    "in a topic, names what the chat read, this account's connections and what it can reach",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const notes = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-setup-notes-" });
        const today = localIsoDate(DateTime.toEpochMillis(yield* DateTime.now));
        yield* write(notes, {
          ".majordome/config.json": "{}",
          ".majordome/topics.json": JSON.stringify({
            topics: [
              { id: "accounting", title: "Accounting", folder: "accounting" },
              { id: "garden", title: "Garden", folder: "garden" },
            ],
          }),
          "AGENTS.md": "Answer in short lines.\n",
          "memory.md": "- Lives in Lyon\n",
          [`daily/${today}.md`]: "- [ ] Call the bank\n",
          "accounting/log.md": "VAT is due on the 15th.\n",
          ".agents/skills/file-receipts/SKILL.md": skill("file-receipts", "File a receipt."),
          ".agents/proposed-skills/not-kept/SKILL.md": skill("not-kept", "Waits for the owner."),
        });
        const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-setup-state-" });
        yield* write(stateDir, {
          "majordome/topics.json": JSON.stringify({
            projects: { [shell.projectId]: { threads: { accounting: threadId } } },
          }),
        });

        const setup = yield* layerSetup({
          notes,
          stateDir,
          connectors: [
            { name: "claude.ai Gmail", status: "connected" },
            { name: "plugin:vercel:vercel", status: "needs-auth" },
          ],
          privateDocuments: Effect.succeed({
            documents: [{ name: "Passport" }],
            accessLog: [],
          } as unknown as MajordomePrivateDocumentsResult),
        });
        const result = yield* Effect.gen(function* () {
          const savedKeys = yield* MajordomeSavedKeys.MajordomeSavedKeys;
          yield* savedKeys.save({ name: "garmin", note: "Runs", value: "g_secret_1" });
          return yield* describe;
        }).pipe(
          Effect.provide(
            layerHandlers.pipe(
              Layer.provideMerge(setup),
              Layer.provideMerge(layerSavedKeysForTest("majordome-setup-tools-")),
            ),
          ),
        );

        expect(result).toEqual({
          startsWith: {
            instructions: ["AGENTS.md"],
            // A skill the assistant wrote and the owner has not kept is not one it uses.
            skills: [{ name: "file-receipts", description: "File a receipt." }],
            memoryNote: "memory.md",
            dailyNotes: [`daily/${today}.md`],
            topic: { title: "Accounting", folder: "accounting" },
            otherTopics: ["Garden"],
            otherTopicsTotal: 1,
          },
          canUse: {
            connections: [
              { name: "claude.ai Gmail", status: "connected" },
              { name: "plugin:vercel:vercel", status: "needs-auth" },
            ],
          },
          canReach: {
            computer: "Home Mac",
            notesFolder: notes,
            topicFiles: ["invoice-march.pdf"],
            topicFilesTotal: 14,
            savedKeys: [{ name: "garmin", note: "Runs" }],
            privateDocuments: ["Passport"],
          },
        });
        expect(JSON.stringify(result)).not.toContain("g_secret_1");
        expect(JSON.stringify(result)).not.toContain("Lives in Lyon");
      }),
  );

  it.effect(
    "outside a notes folder it says so by leaving parts out, and names a part it could not read",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const folder = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-setup-plain-" });
        const setup = yield* layerSetup({
          notes: folder,
          stateDir: folder,
          privateDocuments: Effect.fail(
            new MajordomePrivateDocumentError({ reason: "key_unavailable" }),
          ),
        });
        const result = yield* describe.pipe(
          Effect.provide(
            layerHandlers.pipe(
              Layer.provideMerge(setup),
              Layer.provideMerge(layerSavedKeysForTest("majordome-setup-plain-tools-")),
            ),
          ),
        );
        expect(result).toEqual({
          startsWith: {
            instructions: [],
            skills: [],
            dailyNotes: [],
            otherTopics: [],
            otherTopicsTotal: 0,
          },
          // This AI account cannot list its connections: absent, not an empty list.
          canUse: {},
          canReach: { computer: "Home Mac", savedKeys: [], privateDocuments: [] },
          couldNotRead: ["private documents"],
        });
      }),
  );
});
