/**
 * Private documents ("Tier B"): one `age` file each in the server's state folder, never in a notes
 * folder. An agent opens one only after the owner allows it on a card; the copy is deleted when
 * the run ends or after 15 minutes, and every outcome is logged. See docs/decisions.md.
 */

import {
  MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES,
  MajordomePrivateDocumentError,
  type MajordomeAddPrivateDocumentInput,
  type MajordomeAnswerPrivateDocumentRequestInput,
  type MajordomePrivateDocument,
  type MajordomePrivateDocumentAccess,
  type MajordomePrivateDocumentInput,
  type MajordomePrivateDocumentRequest,
  type MajordomePrivateDocumentRequestInput,
  type MajordomePrivateDocumentsResult,
  type MajordomeViewPrivateDocumentResult,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as AssetSigner from "../assets/AssetSigner.ts";
import {
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import { base64UrlDecodeUtf8, base64UrlEncode } from "../auth/utils.ts";
import * as ServerConfig from "../config.ts";
import * as OwnerRequestCards from "./ownerRequestCards.ts";
import * as PrivateDocumentsKey from "./PrivateDocumentsKey.ts";
import {
  accessLogLine,
  decodeIndex,
  decryptDocument,
  encodeIndex,
  encryptDocument,
  findDocumentByName,
  readAccessLog,
  safeFileName,
} from "./privateDocumentStore.ts";

/** An opened document is deleted this long after the owner allowed it, if its run has not ended. */
const OPEN_LIFETIME = Duration.minutes(15);
const VIEW_URL_TTL_MS = 60_000;

export const PRIVATE_DOCUMENT_VIEW_ROUTE_PREFIX = "/api/majordome/private-documents";

export type PrivateDocumentRequestResult =
  | { readonly status: "allowed"; readonly path: string; readonly expiresAt: string }
  | { readonly status: "denied" | "timed_out" | "cancelled" | "waiting" }
  | { readonly status: "unknown_document"; readonly available: ReadonlyArray<string> };

interface OpenDocument {
  readonly id: string;
  readonly runId: RunId;
  readonly documentId: string;
  readonly path: string;
  readonly expiresAt: string;
  readonly scope: Scope.Closeable;
}

const ViewClaims = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.Literal("private-document-view"),
    documentId: Schema.String,
    expiresAt: Schema.Number,
  }),
);
const encodeViewClaims = Schema.encodeSync(ViewClaims);
const decodeViewClaims = Schema.decodeUnknownOption(ViewClaims);

export class MajordomePrivateDocuments extends Context.Service<
  MajordomePrivateDocuments,
  {
    /** Metadata and the access log. Never content. */
    readonly list: () => Effect.Effect<
      MajordomePrivateDocumentsResult,
      MajordomePrivateDocumentError
    >;
    /** Encrypts a pending upload into the store and deletes the uploaded plaintext. */
    readonly add: (
      input: MajordomeAddPrivateDocumentInput,
    ) => Effect.Effect<MajordomePrivateDocument, MajordomePrivateDocumentError>;
    readonly remove: (
      input: MajordomePrivateDocumentInput,
    ) => Effect.Effect<void, MajordomePrivateDocumentError>;
    /** The owner's own look: logs it and returns a link that serves the file for a minute. */
    readonly ownerViewUrl: (
      input: MajordomePrivateDocumentInput,
    ) => Effect.Effect<MajordomeViewPrivateDocumentResult, MajordomePrivateDocumentError>;
    /** The decrypted file behind an `ownerViewUrl` token, or none when the token is not good. */
    readonly readForOwner: (token: string) => Effect.Effect<
      Option.Option<{
        readonly document: MajordomePrivateDocument;
        readonly bytes: Uint8Array;
      }>,
      MajordomePrivateDocumentError
    >;
    /**
     * An agent asks to open one document for its current run. Shows the owner a card, sends a
     * push, and waits. `waiting` means no answer yet: the request stays open and the same call
     * joins it again.
     */
    readonly request: (input: {
      readonly threadId: ThreadId;
      readonly name: string;
      readonly reason: string;
    }) => Effect.Effect<PrivateDocumentRequestResult, MajordomePrivateDocumentError>;
    readonly getRequest: (
      input: MajordomePrivateDocumentRequestInput,
    ) => Effect.Effect<MajordomePrivateDocumentRequest | null>;
    readonly answerRequest: (
      input: MajordomeAnswerPrivateDocumentRequestInput,
    ) => Effect.Effect<void, MajordomePrivateDocumentError>;
    /** Follows runs, so a run that ends takes its opened documents and open requests with it. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/majordome/MajordomePrivateDocuments") {}

const storageFailed = (cause: unknown) =>
  new MajordomePrivateDocumentError({ reason: "storage_failed", cause });

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const random = yield* SecureRandom.SecureRandom;
  const key = yield* PrivateDocumentsKey.PrivateDocumentsKey;
  const signer = yield* AssetSigner.AssetSigner;
  const serviceScope = yield* Effect.scope;

  // Protects against notes backups and sync, copies of these files, a look at the disk, and an
  // agent's file tools reading unasked. Not against whoever controls the running server or its
  // account (they reach the key), nor an agent misusing a document it was allowed.
  const root = path.join(config.stateDir, "majordome", "private-documents");
  const indexPath = path.join(root, "index.json");
  const logPath = path.join(root, "access-log.jsonl");
  const encryptedPath = (id: string) => path.join(root, `${id}.age`);
  // Inside the attachments folder because that is the one place outside the workspace every
  // provider may already read. Nothing else is stored under this name, so start-up can empty it.
  const openRoot = path.join(config.attachmentsDir, "private-documents-open");

  const opens = new Map<string, OpenDocument>();
  const openKey = (runId: RunId, documentId: string) => `${runId}\u0000${documentId}`;
  const indexLock = yield* Semaphore.make(1);

  const randomId = random.randomBytes(16).pipe(Effect.map(Hex.encode));
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  // A crash can leave decrypted files behind; nothing is open when the server starts.
  yield* fileSystem.remove(openRoot, { recursive: true, force: true }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Majordome could not clear opened private documents.", { cause }),
    ),
    Effect.withSpan("MajordomePrivateDocuments.sweepOpened"),
  );

  const ensureRoot = fileSystem
    .makeDirectory(root, { recursive: true, mode: 0o700 })
    .pipe(Effect.andThen(fileSystem.chmod(root, 0o700)), Effect.mapError(storageFailed));

  const readIndex = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(indexPath).pipe(Effect.mapError(storageFailed)))) return [];
    const text = yield* fileSystem.readFileString(indexPath).pipe(Effect.mapError(storageFailed));
    const decoded = decodeIndex(text);
    if (Option.isNone(decoded)) return yield* storageFailed("The index does not parse.");
    return decoded.value;
  });

  const writeIndex = (documents: ReadonlyArray<MajordomePrivateDocument>) => {
    const partial = `${indexPath}.partial`;
    return ensureRoot.pipe(
      Effect.andThen(
        fileSystem
          .writeFileString(partial, encodeIndex(documents), { mode: 0o600 })
          .pipe(
            Effect.andThen(fileSystem.rename(partial, indexPath)),
            Effect.mapError(storageFailed),
          ),
      ),
    );
  };

  const appendLog = Effect.fn("MajordomePrivateDocuments.appendLog")(function* (
    entry: Omit<MajordomePrivateDocumentAccess, "at">,
  ) {
    yield* ensureRoot;
    yield* fileSystem
      .writeFileString(logPath, accessLogLine({ at: yield* nowIso, ...entry }), {
        flag: "a",
        mode: 0o600,
      })
      .pipe(Effect.mapError(storageFailed));
  });
  const appendLogOrWarn = (entry: Omit<MajordomePrivateDocumentAccess, "at">) =>
    appendLog(entry).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Majordome could not write the private documents log.", { cause }),
      ),
    );

  const documentById = Effect.fn("MajordomePrivateDocuments.documentById")(function* (id: string) {
    const document = (yield* readIndex).find((candidate) => candidate.id === id);
    if (document === undefined) {
      return yield* new MajordomePrivateDocumentError({ reason: "not_found" });
    }
    return document;
  });

  const decrypt = Effect.fn("MajordomePrivateDocuments.decrypt")(function* (
    document: MajordomePrivateDocument,
  ) {
    const identity = yield* key.identity.pipe(
      Effect.mapError(
        (cause) => new MajordomePrivateDocumentError({ reason: "key_unavailable", cause }),
      ),
    );
    const encrypted = yield* fileSystem
      .readFile(encryptedPath(document.id))
      .pipe(Effect.mapError(storageFailed));
    return yield* decryptDocument(encrypted, identity);
  });

  const closeOpen = Effect.fn("MajordomePrivateDocuments.closeOpen")(function* (
    open: OpenDocument,
  ) {
    const key = openKey(open.runId, open.documentId);
    if (opens.get(key)?.id !== open.id) return;
    opens.delete(key);
    yield* Scope.close(open.scope, Exit.void);
  });

  /** Decrypts one document into a fresh owner-only folder that its scope deletes. */
  const openForRun = Effect.fn("MajordomePrivateDocuments.openForRun")(function* (
    document: MajordomePrivateDocument,
    runId: RunId,
  ) {
    const plain = yield* decrypt(document);
    const id = yield* randomId;
    const directory = path.join(openRoot, id);
    const file = path.join(directory, safeFileName(document.fileName));
    const scope = yield* Scope.make();
    // Registered before anything is written, so a failed write is cleaned up too.
    yield* Scope.addFinalizer(
      scope,
      fileSystem
        .remove(directory, { recursive: true, force: true })
        .pipe(
          Effect.catch((cause) =>
            Effect.logError("Majordome could not delete an opened private document.", { cause }),
          ),
        ),
    );
    yield* fileSystem.makeDirectory(openRoot, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(fileSystem.chmod(openRoot, 0o700)),
      Effect.andThen(fileSystem.makeDirectory(directory, { mode: 0o700 })),
      Effect.andThen(fileSystem.chmod(directory, 0o700)),
      // `wx` never follows or replaces an existing path.
      Effect.andThen(fileSystem.writeFile(file, plain, { flag: "wx", mode: 0o600 })),
      Effect.mapError(storageFailed),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    const open: OpenDocument = {
      id,
      runId,
      documentId: document.id,
      path: file,
      expiresAt: DateTime.formatIso(DateTime.addDuration(yield* DateTime.now, OPEN_LIFETIME)),
      scope,
    };
    opens.set(openKey(runId, document.id), open);
    yield* Effect.sleep(OPEN_LIFETIME).pipe(
      Effect.andThen(closeOpen(open)),
      Effect.forkIn(serviceScope),
    );
    return open;
  });

  yield* Effect.addFinalizer(() =>
    Effect.forEach([...opens.values()], closeOpen, { discard: true }),
  );

  const requests = yield* OwnerRequestCards.make<MajordomePrivateDocumentRequest>({
    delivery: "private_document",
    kind: "private-document",
    // An allowed request was logged before its document was handed over.
    beforeClose: (entry, outcome) =>
      outcome === "allowed"
        ? Effect.void
        : appendLogOrWarn({
            documentId: entry.request.documentId,
            documentName: entry.request.documentName,
            outcome,
            requester: { threadId: entry.request.threadId, title: entry.request.threadTitle },
            reason: entry.request.reason,
          }),
  });
  const unavailable = (error: OwnerRequestCards.OwnerRequestUnavailable) =>
    new MajordomePrivateDocumentError({ reason: error.reason, cause: error.cause });

  const list: MajordomePrivateDocuments["Service"]["list"] = Effect.fn(
    "MajordomePrivateDocuments.list",
  )(function* () {
    const documents = yield* readIndex;
    const log = (yield* fileSystem.exists(logPath).pipe(Effect.mapError(storageFailed)))
      ? yield* fileSystem.readFileString(logPath).pipe(Effect.mapError(storageFailed))
      : "";
    return { documents, accessLog: readAccessLog(log) };
  });

  const add: MajordomePrivateDocuments["Service"]["add"] = Effect.fn(
    "MajordomePrivateDocuments.add",
  )(function* (input) {
    // Only a fresh upload: never a file some conversation already holds.
    const source =
      parseThreadSegmentFromAttachmentId(input.attachmentId) === PENDING_ATTACHMENT_THREAD_SEGMENT
        ? resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: input.attachmentId,
          })
        : null;
    if (source === null) {
      return yield* new MajordomePrivateDocumentError({ reason: "upload_missing" });
    }
    return yield* Effect.gen(function* () {
      const { size } = yield* fileSystem.stat(source).pipe(Effect.mapError(storageFailed));
      if (Number(size) > MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES) {
        return yield* new MajordomePrivateDocumentError({ reason: "too_large" });
      }
      if (Number(size) === 0) return yield* new MajordomePrivateDocumentError({ reason: "empty" });
      const plain = yield* fileSystem.readFile(source).pipe(Effect.mapError(storageFailed));
      const identity = yield* key.identity.pipe(
        Effect.mapError(
          (cause) => new MajordomePrivateDocumentError({ reason: "key_unavailable", cause }),
        ),
      );
      const encrypted = yield* encryptDocument(plain, identity);
      const document: MajordomePrivateDocument = {
        id: yield* randomId,
        name: input.name,
        description: input.description?.trim() ?? "",
        fileName: input.fileName,
        mediaType: input.mediaType,
        sizeBytes: plain.byteLength,
        addedAt: yield* nowIso,
        ...(input.topic === undefined ? {} : { topic: input.topic }),
      };
      yield* Effect.gen(function* () {
        const documents = yield* readIndex;
        if (findDocumentByName(documents, document.name) !== undefined) {
          return yield* new MajordomePrivateDocumentError({ reason: "name_taken" });
        }
        const target = encryptedPath(document.id);
        yield* ensureRoot;
        yield* fileSystem
          .writeFile(`${target}.partial`, encrypted, { mode: 0o600 })
          .pipe(
            Effect.andThen(fileSystem.rename(`${target}.partial`, target)),
            Effect.mapError(storageFailed),
          );
        yield* writeIndex([...documents, document]);
      }).pipe(indexLock.withPermits(1));
      yield* appendLogOrWarn({
        documentId: document.id,
        documentName: document.name,
        outcome: "added",
      });
      return document;
    }).pipe(
      // The uploaded plaintext goes whether or not the document was kept.
      Effect.ensuring(
        fileSystem
          .remove(source, { force: true })
          .pipe(
            Effect.catch((cause) =>
              Effect.logError("Majordome could not delete a private document's upload.", { cause }),
            ),
          ),
      ),
    );
  });

  const remove: MajordomePrivateDocuments["Service"]["remove"] = Effect.fn(
    "MajordomePrivateDocuments.remove",
  )(function* (input) {
    const document = yield* Effect.gen(function* () {
      const documents = yield* readIndex;
      const found = documents.find((candidate) => candidate.id === input.id);
      if (found === undefined) {
        return yield* new MajordomePrivateDocumentError({ reason: "not_found" });
      }
      yield* writeIndex(documents.filter((candidate) => candidate.id !== input.id));
      yield* fileSystem
        .remove(encryptedPath(input.id), { force: true })
        .pipe(Effect.mapError(storageFailed));
      return found;
    }).pipe(indexLock.withPermits(1));
    yield* Effect.forEach(
      [...opens.values()].filter((open) => open.documentId === document.id),
      closeOpen,
      { discard: true },
    );
    yield* requests.cancelWhere((entry) => entry.request.documentId === document.id);
    yield* appendLogOrWarn({
      documentId: document.id,
      documentName: document.name,
      outcome: "removed",
    });
  });

  const ownerViewUrl: MajordomePrivateDocuments["Service"]["ownerViewUrl"] = Effect.fn(
    "MajordomePrivateDocuments.ownerViewUrl",
  )(function* (input) {
    const document = yield* documentById(input.id);
    const expiresAt = (yield* Clock.currentTimeMillis) + VIEW_URL_TTL_MS;
    const payload = base64UrlEncode(
      encodeViewClaims({ kind: "private-document-view", documentId: document.id, expiresAt }),
    );
    const signature = yield* signer.sign(payload).pipe(Effect.mapError(storageFailed));
    // Logged before the link exists: a view that cannot be logged does not happen.
    yield* appendLog({
      documentId: document.id,
      documentName: document.name,
      outcome: "owner_viewed",
    });
    return {
      relativeUrl: `${PRIVATE_DOCUMENT_VIEW_ROUTE_PREFIX}/${payload}.${signature}`,
      expiresAt,
    };
  });

  const readForOwner: MajordomePrivateDocuments["Service"]["readForOwner"] = Effect.fn(
    "MajordomePrivateDocuments.readForOwner",
  )(function* (token) {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return Option.none();
    if (!(yield* signer.verify(payload, signature).pipe(Effect.orElseSucceed(() => false)))) {
      return Option.none();
    }
    const claims = Option.flatMap(
      Option.liftThrowable(base64UrlDecodeUtf8)(payload),
      decodeViewClaims,
    );
    if (Option.isNone(claims) || claims.value.expiresAt <= (yield* Clock.currentTimeMillis)) {
      return Option.none();
    }
    const document = yield* documentById(claims.value.documentId);
    return Option.some({ document, bytes: yield* decrypt(document) });
  });

  const request: MajordomePrivateDocuments["Service"]["request"] = Effect.fn(
    "MajordomePrivateDocuments.request",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId });
    const documents = yield* readIndex;
    const document = findDocumentByName(documents, input.name);
    if (document === undefined) {
      return {
        status: "unknown_document" as const,
        available: documents.map((candidate) => candidate.name),
      };
    }
    const run = yield* requests.activeRun(input.threadId).pipe(Effect.mapError(unavailable));
    const allowed = (open: OpenDocument) => ({
      status: "allowed" as const,
      path: open.path,
      expiresAt: open.expiresAt,
    });
    // Allowed moments ago for this run: the same file, no second prompt.
    const alreadyOpen = opens.get(openKey(run.runId, document.id));
    if (alreadyOpen !== undefined) return allowed(alreadyOpen);

    const reason = input.reason.trim();
    const entry =
      requests.find(
        (candidate) =>
          candidate.runId === run.runId && candidate.request.documentId === document.id,
      ) ??
      (yield* requests
        .open({
          threadId: input.threadId,
          runId: run.runId,
          nodeId: run.nodeId,
          label: document.name,
          reason,
          pushBody: `${run.threadTitle} asks to open ${document.name}.`,
          request: (card) => ({
            threadId: input.threadId,
            documentId: document.id,
            documentName: document.name,
            threadTitle: run.threadTitle,
            reason,
            ...card,
          }),
        })
        .pipe(Effect.mapError(unavailable)));
    const outcome = yield* requests.wait(entry);
    if (Option.isNone(outcome)) return { status: "waiting" as const };
    if (outcome.value !== "allowed") return { status: outcome.value };
    const open = opens.get(openKey(run.runId, document.id));
    // Allowed, and already past its lifetime before this call came back for it.
    return open === undefined ? { status: "timed_out" as const } : allowed(open);
  });

  const getRequest: MajordomePrivateDocuments["Service"]["getRequest"] = (input) =>
    Effect.sync(() => requests.get(input)?.request ?? null);

  const answerRequest: MajordomePrivateDocuments["Service"]["answerRequest"] = Effect.fn(
    "MajordomePrivateDocuments.answerRequest",
  )(function* (input) {
    yield* Effect.annotateCurrentSpan({
      "orchestration_v2.thread_id": input.threadId,
      "private_document.allow": input.allow,
    });
    // Taken out first so a second answer, the timeout or the run ending cannot also close it.
    const entry = requests.take(input);
    if (entry === undefined) {
      yield* requests.closeStaleCard(input).pipe(Effect.ignore);
      return yield* new MajordomePrivateDocumentError({ reason: "request_closed" });
    }
    if (!input.allow) return yield* requests.finish(entry, "denied");
    yield* Effect.gen(function* () {
      const document = yield* documentById(entry.request.documentId);
      const open = yield* openForRun(document, entry.runId);
      // An access that cannot be logged does not happen.
      yield* appendLog({
        documentId: document.id,
        documentName: document.name,
        outcome: "allowed",
        requester: { threadId: entry.request.threadId, title: entry.request.threadTitle },
        reason: entry.request.reason,
      }).pipe(Effect.tapError(() => closeOpen(open)));
    }).pipe(
      // Still unanswered: the owner can try again or deny.
      Effect.tapError(() => Effect.sync(() => requests.restore(entry))),
      Effect.andThen(requests.finish(entry, "allowed")),
      Effect.uninterruptible,
    );
  });

  const start: MajordomePrivateDocuments["Service"]["start"] = Effect.fn(
    "MajordomePrivateDocuments.start",
  )(function* () {
    yield* requests.followRuns((runId) =>
      Effect.forEach(
        [...opens.values()].filter((open) => open.runId === runId),
        closeOpen,
        { discard: true },
      ),
    );
  });

  return MajordomePrivateDocuments.of({
    list,
    add,
    remove,
    ownerViewUrl,
    readForOwner,
    request,
    getRequest,
    answerRequest,
    start,
  });
});

export const layer = Layer.effect(MajordomePrivateDocuments, make);
