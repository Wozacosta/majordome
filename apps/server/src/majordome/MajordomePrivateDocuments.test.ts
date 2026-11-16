import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { generateX25519Identity } from "age-encryption";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as AssetSigner from "../assets/AssetSigner.ts";
import { createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as MajordomePrivateDocuments from "./MajordomePrivateDocuments.ts";
import * as MajordomePush from "./MajordomePush.ts";
import * as PrivateDocumentsKey from "./PrivateDocumentsKey.ts";
import type { VaultPushMessage } from "./pushDecision.ts";

const threadId = ThreadId.make("thread:taxes");
const runId = RunId.make("run:taxes");
const PASSPORT = new TextEncoder().encode("passport number 12AB34567");

type RecordCommand = Extract<OrchestrationV2ServerCommand, { type: "secret_request.record" }>;

interface Harness {
  readonly service: MajordomePrivateDocuments.MajordomePrivateDocuments["Service"];
  /** One per request shown to the owner; taking it means the request is waiting. */
  readonly pushes: Queue.Queue<VaultPushMessage>;
  /** Every card update, in order. */
  readonly cards: Queue.Queue<RecordCommand>;
  /** Every path the service deleted, once it is gone. */
  readonly removed: Queue.Queue<string>;
  readonly events: Queue.Queue<OrchestrationV2DomainEvent>;
  /** Stops the service, as a server shutting down does. */
  readonly stop: Effect.Effect<void>;
  readonly upload: (bytes: Uint8Array) => Effect.Effect<string>;
  readonly addPassport: Effect.Effect<{ readonly id: string }>;
  readonly openRoot: string;
  readonly state: { runStatus: string };
}

const baseLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "majordome-private-documents-",
}).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

/** Builds the service over the shared temp state folder; called twice, it is a restarted server. */
const startService = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const pushes = yield* Queue.unbounded<VaultPushMessage>();
  const cards = yield* Queue.unbounded<RecordCommand>();
  const removed = yield* Queue.unbounded<string>();
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const state = { runStatus: "running" };
  const identity = yield* Effect.promise(() => generateX25519Identity());
  const scope = yield* Scope.make();

  const dependencies = Layer.mergeAll(
    Layer.succeed(FileSystem.FileSystem, {
      ...fileSystem,
      remove: (target, options) =>
        fileSystem.remove(target, options).pipe(Effect.tap(() => Queue.offer(removed, target))),
    }),
    Layer.succeed(PrivateDocumentsKey.PrivateDocumentsKey, { identity: Effect.succeed(identity) }),
    Layer.mock(AssetSigner.AssetSigner)({
      sign: () => Effect.succeed("signed"),
      verify: (_payload, signature) => Effect.succeed(signature === "signed"),
    }),
    Layer.mock(MajordomePush.MajordomePush)({
      notifyAll: (message) => Queue.offer(pushes, message).pipe(Effect.as(1)),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("environment:home")),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadRecords: () =>
        Effect.succeed({
          thread: { title: "Do my taxes" },
          runs: [{ id: runId, status: state.runStatus, ordinal: 1, rootNodeId: "node:root" }],
          turnItems: [],
        } as never),
      dispatch: (command) =>
        command.type === "secret_request.record"
          ? Queue.offer(cards, command).pipe(Effect.as({} as never))
          : Effect.die("unexpected command"),
      streamDomainEvents: Stream.fromQueue(events),
    }),
  );
  const service = yield* MajordomePrivateDocuments.make.pipe(
    Effect.provide(dependencies),
    Scope.provide(scope),
  );
  yield* service.start().pipe(Scope.provide(scope));

  const upload = (bytes: Uint8Array) =>
    Effect.gen(function* () {
      const attachmentId = createPendingAttachmentId(".pdf");
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFile(path.join(config.attachmentsDir, `${attachmentId}.pdf`), bytes);
      return attachmentId;
    }).pipe(Effect.orDie);
  const addPassport = upload(PASSPORT).pipe(
    Effect.flatMap((attachmentId) =>
      service.add({
        attachmentId,
        name: "Passport",
        description: "Scan of my passport",
        fileName: "passport.pdf",
        mediaType: "application/pdf",
      }),
    ),
    Effect.orDie,
  );
  return {
    service,
    pushes,
    cards,
    removed,
    events,
    stop: Scope.close(scope, Exit.void),
    upload,
    addPassport,
    openRoot: path.join(config.attachmentsDir, "private-documents-open"),
    state,
  } satisfies Harness;
});

const ask = (harness: Harness) =>
  harness.service.request({ threadId, name: "passport", reason: "To fill in the visa form." });

/** Takes card updates until the one with this status. */
const cardWith = (harness: Harness, status: RecordCommand["secretStatus"]) =>
  Queue.take(harness.cards).pipe(Effect.repeat({ until: (card) => card.secretStatus === status }));

/** Takes deletions until one under the opened-documents folder. */
const openedRemoved = (harness: Harness) =>
  Queue.take(harness.removed).pipe(
    Effect.repeat({ until: (target) => target.startsWith(`${harness.openRoot}/`) }),
  );

const outcomes = (harness: Harness) =>
  harness.service
    .list()
    .pipe(Effect.map(({ accessLog }) => accessLog.map((entry) => entry.outcome)));

// Each test gets its own state folder: a fresh server with no documents.
describe("MajordomePrivateDocuments", () => {
  it.effect("keeps only ciphertext, and gives the owner back the same bytes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const harness = yield* startService;
      const attachmentId = yield* harness.upload(PASSPORT);
      const uploaded = path.join(config.attachmentsDir, `${attachmentId}.pdf`);
      const document = yield* harness.service.add({
        attachmentId,
        name: "Passport",
        fileName: "passport.pdf",
        mediaType: "application/pdf",
      });

      assert.isFalse(yield* fileSystem.exists(uploaded));
      const stored = yield* fileSystem.readFile(
        path.join(config.stateDir, "majordome", "private-documents", `${document.id}.age`),
      );
      assert.isTrue(new TextDecoder().decode(stored).startsWith("age-encryption.org/v1"));
      assert.notInclude(new TextDecoder().decode(stored), "12AB34567");
      assert.deepStrictEqual(
        (yield* harness.service.list()).documents.map(({ name, sizeBytes }) => [name, sizeBytes]),
        [["Passport", PASSPORT.byteLength]],
      );

      const sameName = yield* harness.upload(PASSPORT);
      const duplicate = yield* harness.service
        .add({ attachmentId: sameName, name: "passport", fileName: "p.pdf", mediaType: "" })
        .pipe(Effect.flip);
      assert.strictEqual(duplicate.reason, "name_taken");
      assert.isFalse(yield* fileSystem.exists(path.join(config.attachmentsDir, `${sameName}.pdf`)));

      const { relativeUrl } = yield* harness.service.ownerViewUrl({ id: document.id });
      const token = relativeUrl.slice(
        `${MajordomePrivateDocuments.PRIVATE_DOCUMENT_VIEW_ROUTE_PREFIX}/`.length,
      );
      const opened = Option.getOrThrow(yield* harness.service.readForOwner(token));
      assert.deepStrictEqual([...opened.bytes], [...PASSPORT]);
      assert.isTrue(Option.isNone(yield* harness.service.readForOwner(`${token}x`)));
      yield* TestClock.adjust("61 seconds");
      assert.isTrue(Option.isNone(yield* harness.service.readForOwner(token)));

      yield* harness.service.remove({ id: document.id });
      assert.deepStrictEqual((yield* harness.service.list()).documents, []);
      assert.deepStrictEqual(yield* outcomes(harness), ["removed", "owner_viewed", "added"]);
      yield* harness.stop;
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("opens one document for the run only after the owner allows it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const harness = yield* startService;
      yield* harness.addPassport;

      const asking = yield* Effect.forkChild(ask(harness));
      const push = yield* Queue.take(harness.pushes);
      assert.strictEqual(push.body, "Do my taxes asks to open Passport.");
      assert.strictEqual(push.url, "/threads/environment%3Ahome/thread%3Ataxes");
      const card = yield* cardWith(harness, "pending");
      assert.deepInclude(card, {
        label: "Passport",
        reason: "To fill in the visa form.",
        delivery: "private_document",
        runId,
      });
      assert.deepInclude(
        yield* harness.service.getRequest({ threadId, turnItemId: card.turnItemId }),
        { documentName: "Passport", threadTitle: "Do my taxes" },
      );
      assert.isFalse(yield* fileSystem.exists(harness.openRoot));

      yield* harness.service.answerRequest({ threadId, turnItemId: card.turnItemId, allow: true });
      const result = yield* Fiber.join(asking);
      assert.strictEqual(result.status, "allowed");
      if (result.status !== "allowed") return;
      assert.deepStrictEqual([...(yield* fileSystem.readFile(result.path))], [...PASSPORT]);
      assert.isTrue(result.path.endsWith("/passport.pdf"));
      const fileMode = (yield* fileSystem.stat(result.path)).mode & 0o777;
      const folderMode = (yield* fileSystem.stat(result.path.replace(/\/[^/]+$/, ""))).mode & 0o777;
      assert.deepStrictEqual([fileMode, folderMode], [0o600, 0o700]);
      assert.strictEqual((yield* cardWith(harness, "saved")).turnItemId, card.turnItemId);

      // The same run asking again gets the same copy, with no second prompt.
      assert.deepStrictEqual(yield* ask(harness), result);
      assert.isTrue(Option.isNone(yield* Queue.poll(harness.pushes)));

      const again = yield* harness.service
        .answerRequest({ threadId, turnItemId: card.turnItemId, allow: true })
        .pipe(Effect.flip);
      assert.strictEqual(again.reason, "request_closed");

      yield* harness.stop;
      assert.isFalse(yield* fileSystem.exists(result.path));
      assert.deepStrictEqual(yield* outcomes(harness), ["allowed", "added"]);
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("deletes an opened document after 15 minutes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const harness = yield* startService;
      yield* harness.addPassport;
      const asking = yield* Effect.forkChild(ask(harness));
      const card = yield* cardWith(harness, "pending");
      yield* harness.service.answerRequest({ threadId, turnItemId: card.turnItemId, allow: true });
      const result = yield* Fiber.join(asking);
      assert.strictEqual(result.status, "allowed");
      if (result.status !== "allowed") return;

      yield* TestClock.adjust("14 minutes");
      assert.isTrue(yield* fileSystem.exists(result.path));
      yield* TestClock.adjust("1 minute");
      yield* openedRemoved(harness);
      assert.isFalse(yield* fileSystem.exists(result.path));
      yield* harness.stop;
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("a run that ends takes its opened document and its open request with it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const harness = yield* startService;
      yield* harness.addPassport;
      const contract = yield* harness.upload(new TextEncoder().encode("the contract"));
      yield* harness.service.add({
        attachmentId: contract,
        name: "Contract",
        fileName: "contract.pdf",
        mediaType: "application/pdf",
      });

      const first = yield* Effect.forkChild(ask(harness));
      const card = yield* cardWith(harness, "pending");
      yield* harness.service.answerRequest({ threadId, turnItemId: card.turnItemId, allow: true });
      const opened = yield* Fiber.join(first);
      assert.strictEqual(opened.status, "allowed");
      if (opened.status !== "allowed") return;

      const second = yield* Effect.forkChild(
        harness.service.request({ threadId, name: "Contract", reason: "To check the dates." }),
      );
      yield* cardWith(harness, "pending");
      yield* Queue.offer(harness.events, {
        type: "run.updated",
        payload: { id: runId, status: "completed" },
      } as never);

      assert.deepStrictEqual(yield* Fiber.join(second), { status: "cancelled" });
      assert.isFalse(yield* fileSystem.exists(opened.path));
      assert.strictEqual((yield* outcomes(harness))[0], "cancelled");

      harness.state.runStatus = "completed";
      const stopped = yield* ask(harness).pipe(Effect.flip);
      assert.strictEqual(stopped.reason, "agent_stopped");
      yield* harness.stop;
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("a denied request opens nothing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const harness = yield* startService;
      yield* harness.addPassport;
      const asking = yield* Effect.forkChild(ask(harness));
      const card = yield* cardWith(harness, "pending");
      yield* harness.service.answerRequest({ threadId, turnItemId: card.turnItemId, allow: false });

      assert.deepStrictEqual(yield* Fiber.join(asking), { status: "denied" });
      assert.strictEqual((yield* cardWith(harness, "declined")).turnItemId, card.turnItemId);
      assert.isFalse(yield* fileSystem.exists(harness.openRoot));
      const [entry] = (yield* harness.service.list()).accessLog;
      assert.deepInclude(entry, {
        outcome: "denied",
        documentName: "Passport",
        reason: "To fill in the visa form.",
        requester: { threadId, title: "Do my taxes" },
      });
      assert.deepStrictEqual(
        yield* harness.service.request({ threadId, name: "Diploma", reason: "Needed." }),
        { status: "unknown_document", available: ["Passport"] },
      );
      yield* harness.stop;
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("a request nobody answers is denied after 24 hours", () =>
    Effect.gen(function* () {
      const harness = yield* startService;
      yield* harness.addPassport;
      const asking = yield* Effect.forkChild(ask(harness));
      const card = yield* cardWith(harness, "pending");

      // One tool call gives up waiting after an hour; the request itself stays open.
      yield* TestClock.adjust("60 minutes");
      assert.deepStrictEqual(yield* Fiber.join(asking), { status: "waiting" });
      assert.isNotNull(
        yield* harness.service.getRequest({ threadId, turnItemId: card.turnItemId }),
      );

      yield* TestClock.adjust("23 hours");
      assert.strictEqual((yield* cardWith(harness, "cancelled")).turnItemId, card.turnItemId);
      assert.isNull(yield* harness.service.getRequest({ threadId, turnItemId: card.turnItemId }));
      assert.strictEqual((yield* outcomes(harness))[0], "timed_out");
      const late = yield* harness.service
        .answerRequest({ threadId, turnItemId: card.turnItemId, allow: true })
        .pipe(Effect.flip);
      assert.strictEqual(late.reason, "request_closed");
      yield* harness.stop;
    }).pipe(Effect.provide(baseLayer)),
  );

  it.effect("clears documents a crashed server left open when it starts", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const leftover = path.join(config.attachmentsDir, "private-documents-open", "abc", "tax.pdf");
      yield* fileSystem.makeDirectory(path.dirname(leftover), { recursive: true });
      yield* fileSystem.writeFileString(leftover, "plaintext");

      const harness = yield* startService;
      assert.isFalse(yield* fileSystem.exists(leftover));
      yield* harness.stop;
    }).pipe(Effect.provide(baseLayer)),
  );
});
