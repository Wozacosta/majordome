/**
 * The documents kept with a topic: every file in the topic's folder that is not Markdown (Markdown
 * is a note, and Notes shows it). They sit in the vault beside the notes and are saved, backed up
 * and undone with them; nothing is stored elsewhere. Writes hold the vault's lock.
 */

import {
  MAJORDOME_TOPIC_FILE_MAX_BYTES,
  MAJORDOME_TOPIC_FILE_TOO_LARGE,
  type MajordomeAddTopicFileInput,
  type MajordomeTopicFile,
  type MajordomeTopicFileInput,
  MajordomeTopicFilesError,
  type MajordomeTopicFilesInput,
  type MajordomeTopicFilesResult,
  type MajordomeViewTopicFileResult,
  ProjectId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as AssetSigner from "../assets/AssetSigner.ts";
import {
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import { base64UrlDecodeUtf8, base64UrlEncode } from "../auth/utils.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { isMarkdownFile, isSkippedEntry } from "./notesIndex.ts";
import { safeFileName } from "./privateDocumentStore.ts";
import { readVaultLayout } from "./vaultConfig.ts";
import * as VaultLock from "./VaultLock.ts";
import { readVaultTopics } from "./vaultTopics.ts";

const MAX_FILES = 100;
const MAX_FOLDER_DEPTH = 32;
const STAT_CONCURRENCY = 16;
const VIEW_URL_TTL_MS = 60_000;
/** The saved history a backup sends; past this the card says backups take longer. */
const LARGE_VAULT_KIB = 1024 * 1024;

export const TOPIC_FILE_VIEW_ROUTE_PREFIX = "/api/majordome/topic-files";

const ViewClaims = Schema.fromJsonString(
  Schema.Struct({
    kind: Schema.Literal("topic-file-view"),
    projectId: ProjectId,
    path: Schema.String,
    expiresAt: Schema.Number,
  }),
);
const encodeViewClaims = Schema.encodeSync(ViewClaims);
const decodeViewClaims = Schema.decodeUnknownOption(ViewClaims);

const isTopicFilesError = Schema.is(MajordomeTopicFilesError);
const fail = (message: string) => new MajordomeTopicFilesError({ message });

/** `bill.pdf` → `bill 2.pdf`, `bill 3.pdf`: the first name `taken` does not hold. */
function freeFileName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} ${n}${extension}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Kibibytes of the repository's objects, from `git count-objects -v`; null when it does not say. */
function parseCountObjectsKib(stdout: string): number | null {
  const read = (key: string) => {
    const value = new RegExp(`^${key}: (\\d+)$`, "m").exec(stdout)?.[1];
    return value === undefined ? null : Number(value);
  };
  const loose = read("size");
  const packed = read("size-pack");
  return loose === null || packed === null ? null : loose + packed;
}

const entryOf = (relativePath: string, info: FileSystem.File.Info): MajordomeTopicFile => ({
  path: relativePath,
  name: relativePath.split("/").at(-1) ?? relativePath,
  sizeBytes: Number(info.size),
  modifiedAt: DateTime.formatIso(
    DateTime.makeUnsafe(Option.getOrUndefined(info.mtime)?.getTime() ?? 0),
  ),
});

/**
 * Every file under `top` (vault-relative; "" for the whole vault) that is not Markdown, skipping
 * hidden folders. One directory read per folder and one stat per entry; nothing is opened.
 */
export const scanVaultFiles = Effect.fn("MajordomeTopicFiles.scan")(function* (
  vaultRoot: string,
  top: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found: Array<MajordomeTopicFile> = [];
  // Per folder, inside the scan's span.
  const visit: (folder: string, depth: number) => Effect.Effect<void> = Effect.fnUntraced(
    function* (folder, depth) {
      const names = yield* fileSystem
        .readDirectory(path.join(vaultRoot, folder))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      const folders: Array<string> = [];
      yield* Effect.forEach(
        names,
        // Per directory entry, inside the scan's span.
        Effect.fnUntraced(function* (name) {
          if (isSkippedEntry(name)) return;
          const relative = folder === "" ? name : `${folder}/${name}`;
          const info = yield* fileSystem.stat(path.join(vaultRoot, relative)).pipe(Effect.option);
          if (Option.isNone(info)) return;
          if (info.value.type === "Directory") {
            if (depth < MAX_FOLDER_DEPTH) folders.push(relative);
          } else if (info.value.type === "File" && !isMarkdownFile(name)) {
            found.push(entryOf(relative, info.value));
          }
        }),
        { concurrency: STAT_CONCURRENCY, discard: true },
      );
      yield* Effect.forEach(folders, (next) => visit(next, depth + 1), { discard: true });
    },
  );
  yield* visit(top, 0);
  return found;
});

export class MajordomeTopicFiles extends Context.Service<
  MajordomeTopicFiles,
  {
    readonly list: (
      input: MajordomeTopicFilesInput,
    ) => Effect.Effect<MajordomeTopicFilesResult, MajordomeTopicFilesError>;
    /** Moves a pending upload into the topic's folder, under a name that replaces nothing. */
    readonly add: (
      input: MajordomeAddTopicFileInput,
    ) => Effect.Effect<MajordomeTopicFile, MajordomeTopicFilesError>;
    readonly remove: (
      input: MajordomeTopicFileInput,
    ) => Effect.Effect<void, MajordomeTopicFilesError>;
    /** A link that serves the file for a minute. */
    readonly viewUrl: (
      input: MajordomeTopicFileInput,
    ) => Effect.Effect<MajordomeViewTopicFileResult, MajordomeTopicFilesError>;
    /** The file behind a `viewUrl` token, or none when the token or the file is not good. */
    readonly readForOwner: (
      token: string,
    ) => Effect.Effect<Option.Option<{ readonly path: string; readonly fileName: string }>>;
  }
>()("t3/majordome/MajordomeTopicFiles") {}

const NOT_A_TOPIC_FILE = "That file is not one of a topic's files.";

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const vaultLock = yield* VaultLock.VaultLock;
  const config = yield* ServerConfig.ServerConfig;
  const signer = yield* AssetSigner.AssetSigner;
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const provideFs = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  /** The vault's folder and topics, or undefined for a project that is not a vault. */
  const vaultOf = Effect.fn("MajordomeTopicFiles.vaultOf")(function* (projectId: ProjectId) {
    const project = Option.getOrUndefined(yield* projects.get(projectId));
    if (project === undefined) return undefined;
    const layout = yield* provideFs(readVaultLayout(project.workspaceRoot));
    if (Option.isNone(layout)) return undefined;
    return {
      root: project.workspaceRoot,
      topics: yield* provideFs(readVaultTopics(project.workspaceRoot)),
    };
  });

  const requireVault = (projectId: ProjectId) =>
    vaultOf(projectId).pipe(
      Effect.filterOrFail(
        (vault) => vault !== undefined,
        () => fail("That notes folder was not found."),
      ),
    );

  const insideVault = Effect.fn("MajordomeTopicFiles.insideVault")(function* (
    vaultRoot: string,
    absolute: string,
  ) {
    // A link inside the vault can still point out of it.
    const realRoot = yield* fileSystem.realPath(vaultRoot);
    const real = yield* fileSystem.realPath(absolute);
    return real.startsWith(`${realRoot}${path.sep}`) ? Option.some(real) : Option.none();
  });

  const scan = (vaultRoot: string, top: string) => provideFs(scanVaultFiles(vaultRoot, top));

  /** Never fails: a vault whose size cannot be read is not called large. */
  const isLarge = (vaultRoot: string) =>
    runner
      .run({ command: "git", args: ["count-objects", "-v"], cwd: vaultRoot, timeout: "10 seconds" })
      .pipe(
        Effect.map(
          (result) =>
            result.code === 0 && (parseCountObjectsKib(result.stdout) ?? 0) > LARGE_VAULT_KIB,
        ),
        Effect.catchCause(() => Effect.succeed(false)),
        Effect.withSpan("MajordomeTopicFiles.isLarge"),
      );

  const list: MajordomeTopicFiles["Service"]["list"] = Effect.fn("MajordomeTopicFiles.list")(
    function* (input) {
      const vault = yield* vaultOf(input.projectId);
      const topic = vault?.topics.find((candidate) => candidate.id === input.topicId);
      if (vault === undefined || topic === undefined) return { files: [], total: 0, large: false };
      const [files, large] = yield* Effect.all(
        [scan(vault.root, topic.folder), isLarge(vault.root)],
        {
          concurrency: 2,
        },
      );
      return {
        files: files
          .toSorted(
            (left, right) =>
              right.modifiedAt.localeCompare(left.modifiedAt) ||
              left.path.localeCompare(right.path),
          )
          .slice(0, MAX_FILES),
        total: files.length,
        large,
      };
    },
    Effect.mapError(
      (cause) =>
        new MajordomeTopicFilesError({ message: "Could not read this topic's files.", cause }),
    ),
  );

  const add: MajordomeTopicFiles["Service"]["add"] = Effect.fn("MajordomeTopicFiles.add")(
    function* (input) {
      // Only a fresh upload: never a file some conversation already holds.
      const source =
        parseThreadSegmentFromAttachmentId(input.attachmentId) === PENDING_ATTACHMENT_THREAD_SEGMENT
          ? resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId: input.attachmentId,
            })
          : null;
      if (source === null) return yield* fail("The upload did not arrive. Try adding it again.");
      return yield* Effect.gen(function* () {
        const { size } = yield* fileSystem.stat(source);
        if (Number(size) > MAJORDOME_TOPIC_FILE_MAX_BYTES) {
          return yield* fail(MAJORDOME_TOPIC_FILE_TOO_LARGE);
        }
        const vault = yield* requireVault(input.projectId);
        const topic = vault.topics.find((candidate) => candidate.id === input.topicId);
        if (topic === undefined) return yield* fail("That topic is no longer here.");
        const folder = path.join(vault.root, topic.folder);
        return yield* vaultLock.withLock(
          vault.root,
          Effect.gen(function* () {
            yield* fileSystem.makeDirectory(folder, { recursive: true });
            if (Option.isNone(yield* insideVault(vault.root, folder))) {
              return yield* fail("That topic's folder is not in your notes folder.");
            }
            const taken = new Set(
              (yield* fileSystem.readDirectory(folder)).map((name) => name.toLowerCase()),
            );
            const name = freeFileName(safeFileName(input.fileName), (candidate) =>
              taken.has(candidate.toLowerCase()),
            );
            const target = path.join(folder, name);
            yield* fileSystem.copyFile(source, target);
            return entryOf(`${topic.folder}/${name}`, yield* fileSystem.stat(target));
          }),
        );
      }).pipe(
        Effect.ensuring(
          fileSystem
            .remove(source, { force: true })
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Majordome could not delete a topic file's upload.", { cause }),
              ),
            ),
        ),
      );
    },
    Effect.mapError((cause) =>
      isTopicFilesError(cause)
        ? cause
        : new MajordomeTopicFilesError({ message: "Could not add that file.", cause }),
    ),
  );

  /** The listed file on disk, or a failure for anything that is not a file of one of the topics. */
  const resolveFile = Effect.fn("MajordomeTopicFiles.resolveFile")(function* (
    input: MajordomeTopicFileInput,
  ) {
    const vault = yield* requireVault(input.projectId);
    const outside = fail(NOT_A_TOPIC_FILE);
    if (path.isAbsolute(input.path)) return yield* outside;
    const absolute = path.resolve(vault.root, input.path);
    const segments = path.relative(vault.root, absolute).split(path.sep);
    const name = segments.at(-1) ?? "";
    const relative = segments.join("/");
    if (
      segments.some((segment) => segment === "" || segment === ".." || isSkippedEntry(segment)) ||
      isMarkdownFile(name) ||
      !vault.topics.some((topic) => relative.startsWith(`${topic.folder}/`))
    ) {
      return yield* outside;
    }
    const gone = fail("That file is no longer there.");
    const real = yield* insideVault(vault.root, absolute).pipe(Effect.mapError(() => gone));
    if (Option.isNone(real)) return yield* outside;
    const info = yield* fileSystem.stat(real.value).pipe(Effect.mapError(() => gone));
    if (info.type !== "File") return yield* outside;
    return { root: vault.root, absolute, name };
  });

  const remove: MajordomeTopicFiles["Service"]["remove"] = Effect.fn("MajordomeTopicFiles.remove")(
    function* (input) {
      const vault = yield* requireVault(input.projectId);
      yield* vaultLock.withLock(
        vault.root,
        // The link itself goes, never what it points at.
        resolveFile(input).pipe(Effect.flatMap((file) => fileSystem.remove(file.absolute))),
      );
    },
    Effect.mapError((cause) =>
      isTopicFilesError(cause)
        ? cause
        : new MajordomeTopicFilesError({ message: "Could not remove that file.", cause }),
    ),
  );

  const viewUrl: MajordomeTopicFiles["Service"]["viewUrl"] = Effect.fn(
    "MajordomeTopicFiles.viewUrl",
  )(
    function* (input) {
      yield* resolveFile(input);
      const expiresAt = (yield* Clock.currentTimeMillis) + VIEW_URL_TTL_MS;
      const payload = base64UrlEncode(
        encodeViewClaims({
          kind: "topic-file-view",
          projectId: input.projectId,
          path: input.path,
          expiresAt,
        }),
      );
      const signature = yield* signer.sign(payload);
      return { relativeUrl: `${TOPIC_FILE_VIEW_ROUTE_PREFIX}/${payload}.${signature}`, expiresAt };
    },
    Effect.mapError((cause) =>
      isTopicFilesError(cause)
        ? cause
        : new MajordomeTopicFilesError({ message: "Could not open that file.", cause }),
    ),
  );

  const readForOwner: MajordomeTopicFiles["Service"]["readForOwner"] = Effect.fn(
    "MajordomeTopicFiles.readForOwner",
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
    // Checked again: the file may have moved or been replaced by a link since the link was made.
    return yield* resolveFile(claims.value).pipe(
      Effect.map((file) => Option.some({ path: file.absolute, fileName: file.name })),
      Effect.orElseSucceed(() => Option.none()),
    );
  });

  return MajordomeTopicFiles.of({ list, add, remove, viewUrl, readForOwner });
});

export const layer = Layer.effect(MajordomeTopicFiles, make);
