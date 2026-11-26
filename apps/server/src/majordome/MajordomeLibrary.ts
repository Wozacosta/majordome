/**
 * The Library: every file of a notes folder that is not a note, and every file attached to one of
 * its chats, newest first. Nothing is stored for it: the folder is walked and the chats' messages
 * are read each time it is asked for.
 */

import {
  ChatFileAttachment,
  ChatImageAttachment,
  MajordomeLibraryError,
  type MajordomeLibraryFile,
  type MajordomeLibraryInput,
  type MajordomeLibraryResult,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { scanVaultFiles } from "./MajordomeTopicFiles.ts";
import { readVaultLayout } from "./vaultConfig.ts";

/** What one answer carries: about 200 bytes a file, so a fifth of a megabyte at most. */
const LIBRARY_MAX_FILES = 1_000;
const EXISTS_CONCURRENCY = 16;

// An attachment of a kind this version does not know is left out.
const decodeAttachment = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([ChatImageAttachment, ChatFileAttachment])),
);

export class MajordomeLibrary extends Context.Service<
  MajordomeLibrary,
  {
    readonly list: (
      input: MajordomeLibraryInput,
    ) => Effect.Effect<MajordomeLibraryResult, MajordomeLibraryError>;
  }
>()("t3/majordome/MajordomeLibrary") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const config = yield* ServerConfig.ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const provideFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const notesFiles = Effect.fn("MajordomeLibrary.notesFiles")(function* (vaultRoot: string) {
    const files = yield* provideFs(scanVaultFiles(vaultRoot, ""));
    return files.map((file): MajordomeLibraryFile => ({
      _tag: "notes-file",
      path: file.path,
      name: file.name,
      sizeBytes: file.sizeBytes,
      at: file.modifiedAt,
    }));
  });

  /**
   * What the owner attached in this project's chats. Reads the user messages of its threads; a
   * chat branched from another repeats its messages, so a file counts once, in its first chat.
   */
  const chatFiles = Effect.fn("MajordomeLibrary.chatFiles")(function* (projectId: ProjectId) {
    const rows = yield* sql<{
      threadId: ThreadId;
      threadTitle: string;
      at: string;
      attachment: string;
    }>`
      SELECT thread.thread_id AS "threadId", thread.title AS "threadTitle",
        message.created_at AS at, attachment.value AS attachment
      FROM orchestration_v2_projection_threads AS thread
      JOIN orchestration_v2_projection_messages AS message
        ON message.thread_id = thread.thread_id
      JOIN json_each(message.payload_json, '$.attachments') AS attachment
      WHERE thread.project_id = ${projectId}
        AND thread.deleted_at IS NULL
        AND message.role = 'user'
      ORDER BY message.created_at DESC, message.message_id DESC
    `.pipe(NodeSqliteClient.readOnly);
    const byId = new Map<string, MajordomeLibraryFile & { readonly file: string | null }>();
    for (const row of rows) {
      const attachment = Option.getOrUndefined(decodeAttachment(row.attachment));
      if (attachment === undefined) continue;
      // A long paste the composer turned into a file is the message's text, not a file of theirs.
      if (attachment.type === "file" && attachment.source?._tag === "pasted-text") continue;
      byId.set(attachment.id, {
        _tag: "chat-file",
        attachmentId: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        at: row.at,
        threadId: row.threadId,
        threadTitle: row.threadTitle,
        file: resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment }),
      });
    }
    // A message outlives a file deleted from it.
    const kept = yield* Effect.filter(
      [...byId.values()],
      ({ file }) =>
        file === null
          ? Effect.succeed(false)
          : fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false)),
      { concurrency: EXISTS_CONCURRENCY },
    );
    return kept.map(({ file: _file, ...rest }): MajordomeLibraryFile => rest);
  });

  const list: MajordomeLibrary["Service"]["list"] = Effect.fn("MajordomeLibrary.list")(
    function* (input) {
      const project = Option.getOrUndefined(yield* projects.get(input.projectId));
      const layout =
        project === undefined
          ? Option.none()
          : yield* provideFs(readVaultLayout(project.workspaceRoot));
      if (project === undefined || Option.isNone(layout)) return { files: [], total: 0 };
      const [notes, chats] = yield* Effect.all(
        [
          input.chatsOnly === true ? Effect.succeed([]) : notesFiles(project.workspaceRoot),
          chatFiles(input.projectId),
        ],
        { concurrency: 2 },
      );
      const files = [...notes, ...chats].toSorted(
        (left, right) => right.at.localeCompare(left.at) || left.name.localeCompare(right.name),
      );
      return { files: files.slice(0, LIBRARY_MAX_FILES), total: files.length };
    },
    Effect.mapError(
      (cause) => new MajordomeLibraryError({ message: "Could not read your files.", cause }),
    ),
  );

  return MajordomeLibrary.of({ list });
});

export const layer = Layer.effect(MajordomeLibrary, make);
