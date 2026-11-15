/**
 * Folder backup: the vault's whole history as one `git bundle`, encrypted with `age` and the
 * owner's passphrase, written as `majordome-<vault>-<YYYY-MM-DD>.age`. The last few are kept.
 * Restoring needs only `age -d` and `git clone`, no Majordome.
 */

// @effect-diagnostics nodeBuiltinImport:off -- age encrypts Web streams; Node's file streams feed it without holding a whole vault in memory.
import * as NodeFS from "node:fs";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";

import { Decrypter, Encrypter } from "age-encryption";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export const FOLDER_BACKUP_KEEP = 14;

export class FolderBackupError extends Schema.TaggedError<FolderBackupError>()(
  "FolderBackupError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

const isFolderBackupError = Schema.is(FolderBackupError);

const folderBackupFileName = (slug: string, date: string) => `majordome-${slug}-${date}.age`;

const backupFilePattern = (slug: string) =>
  new RegExp(
    `^majordome-${slug.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{4}-\\d{2}-\\d{2}\\.age$`,
  );

/** Writes the vault's history to `bundlePath`. Callers hold the vault's lock. */
export const createVaultBundle = Effect.fn("majordome.createVaultBundle")(function* (input: {
  readonly cwd: string;
  readonly bundlePath: string;
}) {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const result = yield* git.execute({
    operation: "majordome.vaultBundle",
    cwd: input.cwd,
    args: ["bundle", "create", "--quiet", input.bundlePath, "--all"],
    allowNonZeroExit: true,
    timeoutMs: 10 * 60_000,
  });
  if (result.exitCode !== 0) {
    return yield* new FolderBackupError({
      message: "There is nothing to back up yet: the vault has no saved changes.",
    });
  }
});

const encryptFile = (input: {
  readonly source: string;
  readonly target: string;
  readonly passphrase: string;
  /** Only tests lower it; age's default makes guessing a passphrase slow. */
  readonly scryptWorkFactor?: number;
}) =>
  Effect.tryPromise({
    try: async () => {
      const encrypter = new Encrypter();
      encrypter.setPassphrase(input.passphrase);
      if (input.scryptWorkFactor !== undefined) {
        encrypter.setScryptWorkFactor(input.scryptWorkFactor);
      }
      const plain = NodeStream.Readable.toWeb(
        NodeFS.createReadStream(input.source),
      ) as ReadableStream<Uint8Array>;
      const encrypted = await encrypter.encrypt(plain);
      await NodeStreamPromises.pipeline(
        NodeStream.Readable.fromWeb(encrypted as Parameters<typeof NodeStream.Readable.fromWeb>[0]),
        NodeFS.createWriteStream(input.target, { mode: 0o600 }),
      );
    },
    catch: (cause) => new FolderBackupError({ message: "Could not encrypt the backup.", cause }),
  }).pipe(Effect.withSpan("majordome.encryptFile"));

export const decryptFile = (input: {
  readonly source: string;
  readonly target: string;
  readonly passphrase: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const decrypter = new Decrypter();
      decrypter.addPassphrase(input.passphrase);
      const encrypted = NodeStream.Readable.toWeb(
        NodeFS.createReadStream(input.source),
      ) as ReadableStream<Uint8Array>;
      const plain = await decrypter.decrypt(encrypted);
      await NodeStreamPromises.pipeline(
        NodeStream.Readable.fromWeb(plain as Parameters<typeof NodeStream.Readable.fromWeb>[0]),
        NodeFS.createWriteStream(input.target, { mode: 0o600 }),
      );
    },
    catch: (cause) => new FolderBackupError({ message: "Could not decrypt the backup.", cause }),
  }).pipe(Effect.withSpan("majordome.decryptFile"));

/** Moves the encrypted bundle into the folder under today's name and drops the oldest copies. */
export const storeFolderBackup = Effect.fn("majordome.storeFolderBackup")(function* (input: {
  readonly bundlePath: string;
  readonly folder: string;
  readonly slug: string;
  readonly date: string;
  readonly passphrase: string;
  readonly keep: number;
  readonly scryptWorkFactor?: number;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fileName = folderBackupFileName(input.slug, input.date);
  const target = path.join(input.folder, fileName);
  // Written beside the target and renamed, so a cut-off write never replaces a good copy.
  const partial = path.join(input.folder, `.${fileName}.partial`);
  yield* encryptFile({
    source: input.bundlePath,
    target: partial,
    passphrase: input.passphrase,
    ...(input.scryptWorkFactor === undefined ? {} : { scryptWorkFactor: input.scryptWorkFactor }),
  }).pipe(
    Effect.andThen(fileSystem.rename(partial, target)),
    Effect.tapError(() => fileSystem.remove(partial).pipe(Effect.ignore)),
    Effect.mapError((cause) =>
      isFolderBackupError(cause)
        ? cause
        : new FolderBackupError({ message: "Could not write the backup to the folder.", cause }),
    ),
  );

  const pattern = backupFilePattern(input.slug);
  const existing = (yield* fileSystem
    .readDirectory(input.folder)
    .pipe(Effect.orElseSucceed(() => [])))
    .filter((name) => pattern.test(name))
    .toSorted()
    .toReversed();
  for (const old of existing.slice(Math.max(1, input.keep))) {
    yield* fileSystem.remove(path.join(input.folder, old)).pipe(Effect.ignore);
  }
  return { file: target };
});

/**
 * A usable backup folder: an existing, writable directory outside the vault, so the backups never
 * end up inside the history they back up.
 */
export const validateBackupFolder = Effect.fn("majordome.validateBackupFolder")(function* (input: {
  readonly folder: string;
  readonly vaultRoot: string;
  readonly homeDirectory: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = input.folder.trim();
  const expanded =
    raw === "~"
      ? input.homeDirectory
      : raw.startsWith("~/")
        ? path.join(input.homeDirectory, raw.slice(2))
        : raw;
  if (!path.isAbsolute(expanded)) {
    return yield* new FolderBackupError({
      message: "Give the folder's full path, starting with / or ~/.",
    });
  }
  const folder = path.resolve(expanded);
  const info = yield* fileSystem.stat(folder).pipe(Effect.option);
  if (info._tag === "None" || info.value.type !== "Directory") {
    return yield* new FolderBackupError({
      message: "That folder does not exist on this computer.",
    });
  }
  const vaultRoot = path.resolve(input.vaultRoot);
  const relative = path.relative(vaultRoot, folder);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return yield* new FolderBackupError({
      message: "Choose a folder outside your notes, such as iCloud Drive, Dropbox or a USB drive.",
    });
  }
  const probe = path.join(folder, `.majordome-write-test-${yield* Clock.currentTimeMillis}`);
  yield* fileSystem.writeFileString(probe, "").pipe(
    Effect.andThen(fileSystem.remove(probe)),
    Effect.mapError(
      (cause) =>
        new FolderBackupError({ message: "Majordome cannot write to that folder.", cause }),
    ),
  );
  return folder;
});
