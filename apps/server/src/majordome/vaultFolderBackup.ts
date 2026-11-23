/**
 * Folder backup: the vault's whole history as one `git bundle`, encrypted with `age` and the
 * owner's passphrase, written as `majordome-<vault>-<YYYY-MM-DD>.age`. The last few are kept.
 * Majordome restores one into a new folder; `age -d` and `git clone` do the same without it.
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
import * as Stream from "effect/Stream";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

export const FOLDER_BACKUP_KEEP = 5;

export class FolderBackupError extends Schema.TaggedError<FolderBackupError>()(
  "FolderBackupError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export const folderBackupFileName = (slug: string, date: string) => `majordome-${slug}-${date}.age`;

export const backupFilePattern = (slug: string) =>
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

export const encryptFile = (input: {
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
    catch: (cause) =>
      new FolderBackupError({
        message:
          "That passphrase did not open the backup. Check it against the one you wrote down: capitals and spaces count.",
        cause,
      }),
  }).pipe(Effect.withSpan("majordome.decryptFile"));

/** Copies the encrypted bundle into the folder under today's name and drops the oldest copies. */
export const storeFolderBackup = Effect.fn("majordome.storeFolderBackup")(function* (input: {
  readonly encryptedPath: string;
  readonly folder: string;
  readonly slug: string;
  readonly date: string;
  readonly keep: number;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fileName = folderBackupFileName(input.slug, input.date);
  const target = path.join(input.folder, fileName);
  // Written beside the target and renamed, so a cut-off write never replaces a good copy.
  const partial = path.join(input.folder, `.${fileName}.partial`);
  yield* fileSystem.copyFile(input.encryptedPath, partial).pipe(
    Effect.andThen(fileSystem.rename(partial, target)),
    Effect.tapError(() => fileSystem.remove(partial).pipe(Effect.ignore)),
    Effect.mapError(
      (cause) =>
        new FolderBackupError({ message: "Could not write the backup to the folder.", cause }),
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

const ANY_BACKUP_FILE = /^majordome-(.+)-(\d{4}-\d{2}-\d{2})\.age$/;
const AGE_HEADER = "age-encryption.org/v1";

const expandHome = (raw: string, homeDirectory: string, path: Path.Path) =>
  raw === "~" ? homeDirectory : raw.startsWith("~/") ? path.join(homeDirectory, raw.slice(2)) : raw;

/** The backup file to open: the one named, or the newest copy in the folder named. */
export const findBackupFile = Effect.fn("majordome.findBackupFile")(function* (input: {
  readonly source: string;
  readonly homeDirectory: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const expanded = expandHome(input.source.trim(), input.homeDirectory, path);
  if (!path.isAbsolute(expanded)) {
    return yield* new FolderBackupError({
      message: "Give the backup's full path, starting with / or ~/.",
    });
  }
  const source = path.resolve(expanded);
  const info = yield* fileSystem.stat(source).pipe(Effect.option);
  if (info._tag === "None") {
    return yield* new FolderBackupError({
      message: "Majordome cannot find that file or folder on this computer.",
    });
  }
  if (info.value.type !== "Directory") return source;
  const copies = (yield* fileSystem
    .readDirectory(source)
    .pipe(Effect.orElseSucceed((): Array<string> => []))).flatMap((name) => {
    const match = ANY_BACKUP_FILE.exec(name);
    return match === null ? [] : [{ name, notes: match[1]!, date: match[2]! }];
  });
  if (copies.length === 0) {
    return yield* new FolderBackupError({
      message:
        "There is no Majordome backup in that folder. Backup files have names like majordome-notes-2026-01-31.age.",
    });
  }
  const notes = [...new Set(copies.map((copy) => copy.notes))];
  if (notes.length > 1) {
    return yield* new FolderBackupError({
      message: `That folder holds backups of ${notes.length} different notes folders (${notes.join(", ")}). Give the full path of the file you want instead.`,
    });
  }
  const newest = copies.toSorted((left, right) => right.date.localeCompare(left.date))[0]!;
  return path.join(source, newest.name);
});

/**
 * Opens an encrypted backup into a new folder inside `into` and returns that folder. It never
 * writes into a folder that exists: a taken name gets a number. A failure leaves nothing behind.
 */
export const restoreFolderBackup = Effect.fn("majordome.restoreFolderBackup")(function* (input: {
  readonly file: string;
  readonly passphrase: string;
  readonly into: string;
  readonly name: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const notBackup = new FolderBackupError({
    message: "That file is not a Majordome backup. Backup files end in .age.",
  });

  const header = yield* fileSystem.stream(input.file, { bytesToRead: AGE_HEADER.length }).pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.orElseSucceed(() => ""),
  );
  if (header !== AGE_HEADER) return yield* notBackup;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "majordome-restore-" });
      const bundlePath = path.join(temp, "notes.bundle");
      yield* decryptFile({
        source: input.file,
        target: bundlePath,
        passphrase: input.passphrase,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new FolderBackupError({
              message:
                "That passphrase does not open this backup. Check it for typos and try again.",
              cause,
            }),
        ),
      );

      // Made beside its final place, so the move into place is one step and never a half copy.
      const staging = yield* fileSystem
        .makeTempDirectoryScoped({ directory: input.into, prefix: ".majordome-restoring-" })
        .pipe(
          Effect.mapError(
            (cause) =>
              new FolderBackupError({
                message: "Majordome cannot write to the folder you chose for your notes.",
                cause,
              }),
          ),
        );
      const clone = path.join(staging, "notes");
      const cloned = yield* git.execute({
        operation: "majordome.restoreClone",
        cwd: staging,
        args: ["clone", "--quiet", bundlePath, clone],
        allowNonZeroExit: true,
        timeoutMs: 10 * 60_000,
      });
      if (cloned.exitCode !== 0) return yield* notBackup;
      // The clone remembers the temporary file it came from; a later backup must not go there.
      yield* git.execute({
        operation: "majordome.restoreClone",
        cwd: clone,
        args: ["remote", "remove", "origin"],
        allowNonZeroExit: true,
      });

      for (let attempt = 1; attempt <= 50; attempt++) {
        const folder = path.join(
          input.into,
          attempt === 1 ? input.name : `${input.name} ${attempt}`,
        );
        if (yield* fileSystem.exists(folder)) continue;
        yield* fileSystem.rename(clone, folder);
        return folder;
      }
      return yield* new FolderBackupError({
        message: `There are too many folders called ${input.name} there. Choose another place.`,
      });
    }),
  ).pipe(
    Effect.mapError((cause) =>
      cause._tag === "FolderBackupError"
        ? cause
        : new FolderBackupError({ message: "Could not bring your notes back.", cause }),
    ),
  );
});

/** Folders that cloud services keep on this computer, as places to suggest for the backup. */
export const findCloudFolders = Effect.fn("majordome.findCloudFolders")(function* (
  homeDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const isFolder = (folder: string) =>
    fileSystem.stat(folder).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
  const cloudStorage = path.join(homeDirectory, "Library", "CloudStorage");
  const mounted = (yield* fileSystem
    .readDirectory(cloudStorage)
    .pipe(Effect.orElseSucceed((): Array<string> => []))).toSorted();
  const candidates = [
    {
      label: "iCloud Drive",
      path: path.join(homeDirectory, "Library", "Mobile Documents", "com~apple~CloudDocs"),
    },
    { label: "Dropbox", path: path.join(homeDirectory, "Dropbox") },
    ...mounted.flatMap((name) =>
      name.startsWith("Dropbox")
        ? [{ label: "Dropbox", path: path.join(cloudStorage, name) }]
        : name.startsWith("OneDrive")
          ? [{ label: "OneDrive", path: path.join(cloudStorage, name) }]
          : name.startsWith("GoogleDrive")
            ? [{ label: "Google Drive", path: path.join(cloudStorage, name, "My Drive") }]
            : [],
    ),
  ];
  const found: Array<{ readonly label: string; readonly path: string }> = [];
  for (const candidate of candidates) {
    if (found.some((other) => other.label === candidate.label)) continue;
    if (yield* isFolder(candidate.path)) found.push(candidate);
  }
  return found;
});
