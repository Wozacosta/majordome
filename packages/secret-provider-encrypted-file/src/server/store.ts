// Named secrets in one `age` file, its key in a second file beside it, both owner-only. An
// unattended server has nobody to type a passphrase, so the key shares the disk: this protects a
// copy of the secrets file alone (a backup, a sync), not a server someone can already read.
import * as HostProcess from "@t3tools/shared/HostProcess";
import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from "age-encryption";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isSecretName } from "../shared/definition.ts";

export interface EncryptedFileLocation {
  readonly directory: string;
  readonly secretsPath: string;
  readonly keyPath: string;
}

/** The store's files inside the server's private secrets directory, which clients cannot read. */
export const encryptedFileLocation = (
  directory: string,
  join: (...parts: ReadonlyArray<string>) => string,
): EncryptedFileLocation => ({
  directory,
  secretsPath: join(directory, "integration-keys.age"),
  keyPath: join(directory, "integration-keys.agekey"),
});

const MAX_VALUE_LENGTH = 64 * 1024;

// No `cause`: a parse or decrypt failure can quote the decrypted text.
export class EncryptedFileError extends Schema.TaggedError<EncryptedFileError>()(
  "EncryptedFileError",
  {
    reason: Schema.Literals([
      "invalid-name",
      "invalid-value",
      "key-missing",
      "key-exposed",
      "undecryptable",
      "unreadable",
      "unwritable",
    ]),
    path: Schema.String,
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-name":
        return "A secret's name starts with a letter or digit and has only letters, digits, and . _ or -.";
      case "invalid-value":
        return "The value is empty or larger than 64 KB.";
      case "key-missing":
        return `The key file ${this.path} is missing, so the saved secrets cannot be opened. Restore it from a backup, or delete the secrets file beside it and save the secrets again.`;
      case "key-exposed":
        return `The key file ${this.path} can be read by other users of this computer. Run: chmod 600 ${this.path}`;
      case "undecryptable":
        return `The secrets file ${this.path} could not be opened with its key file. One of them was replaced or damaged.`;
      case "unreadable":
        return `Could not read ${this.path}.`;
      case "unwritable":
        return `Could not write ${this.path}.`;
    }
  }
}

const Contents = Schema.Struct({
  version: Schema.Literal(1),
  secrets: Schema.Record(Schema.String, Schema.String),
});
const ContentsJson = Schema.fromJsonString(Contents);
const decodeContents = Schema.decodeUnknownOption(ContentsJson);
const encodeContents = Schema.encodeSync(ContentsJson);

const isNotFound = (error: { readonly reason: { readonly _tag: string } }) =>
  error.reason._tag === "NotFound";

const readKey = Effect.fn("EncryptedFileStore.readKey")(function* (
  location: EncryptedFileLocation,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const fail = (reason: EncryptedFileError["reason"]) =>
    new EncryptedFileError({ reason, path: location.keyPath });
  const info = yield* fileSystem
    .stat(location.keyPath)
    .pipe(Effect.mapError((error) => fail(isNotFound(error) ? "key-missing" : "unreadable")));
  // Windows has no owner-only mode bits; its user profile directory is the boundary there.
  if ((yield* HostProcess.Platform) !== "win32" && (info.mode & 0o077) !== 0) {
    return yield* fail("key-exposed");
  }
  const key = yield* fileSystem
    .readFileString(location.keyPath)
    .pipe(Effect.mapError(() => fail("unreadable")));
  return key.trim();
});

/** Every secret in the file, decrypted in memory only. A file that does not exist yet is empty. */
export const readSecrets = Effect.fn("EncryptedFileStore.readSecrets")(function* (
  location: EncryptedFileLocation,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const fail = (reason: EncryptedFileError["reason"]) =>
    new EncryptedFileError({ reason, path: location.secretsPath });
  const encrypted = yield* fileSystem.readFile(location.secretsPath).pipe(
    Effect.asSome,
    Effect.catchIf(isNotFound, () => Effect.succeedNone),
    Effect.mapError(() => fail("unreadable")),
  );
  if (Option.isNone(encrypted)) return {} as Readonly<Record<string, string>>;
  const key = yield* readKey(location);
  const text = yield* Effect.tryPromise({
    try: () => {
      const decrypter = new Decrypter();
      decrypter.addIdentity(key);
      return decrypter.decrypt(encrypted.value, "text");
    },
    catch: () => fail("undecryptable"),
  });
  const contents = decodeContents(text);
  if (Option.isNone(contents)) return yield* fail("undecryptable");
  return contents.value.secrets;
});

const readOrCreateKey = Effect.fn("EncryptedFileStore.readOrCreateKey")(function* (
  location: EncryptedFileLocation,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const fail = () => new EncryptedFileError({ reason: "unwritable", path: location.keyPath });
  if (yield* fileSystem.exists(location.keyPath).pipe(Effect.mapError(fail))) {
    return yield* readKey(location);
  }
  // A key with no secrets file is safe to replace; with one, replacing it would lock them out.
  if (yield* fileSystem.exists(location.secretsPath).pipe(Effect.mapError(fail))) {
    return yield* new EncryptedFileError({ reason: "key-missing", path: location.keyPath });
  }
  const key = yield* Effect.tryPromise({ try: () => generateIdentity(), catch: fail });
  yield* fileSystem
    .writeFileString(location.keyPath, `${key}\n`, { flag: "wx", mode: 0o600 })
    .pipe(Effect.mapError(fail));
  return key;
});

const writeSecrets = Effect.fn("EncryptedFileStore.writeSecrets")(function* (
  location: EncryptedFileLocation,
  secrets: Readonly<Record<string, string>>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const fail = () => new EncryptedFileError({ reason: "unwritable", path: location.secretsPath });
  yield* fileSystem
    .makeDirectory(location.directory, { recursive: true })
    .pipe(Effect.mapError(fail));
  const key = yield* readOrCreateKey(location);
  const encrypted = yield* Effect.tryPromise({
    try: async () => {
      const encrypter = new Encrypter();
      encrypter.addRecipient(await identityToRecipient(key));
      return encrypter.encrypt(encodeContents({ version: 1, secrets }));
    },
    catch: fail,
  });
  // Written whole beside the target and renamed over it, so a crash never leaves half a file.
  const suffix = yield* (yield* SecureRandom.SecureRandom).uuidV4().pipe(Effect.mapError(fail));
  const temporaryPath = `${location.secretsPath}.${suffix}.tmp`;
  yield* fileSystem.writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 }).pipe(
    Effect.andThen(fileSystem.rename(temporaryPath, location.secretsPath)),
    Effect.onError(() => fileSystem.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
    Effect.mapError(fail),
  );
});

/** Adds or replaces one secret. Two writers at once keep the last one's file. */
export const setSecret = Effect.fn("EncryptedFileStore.setSecret")(function* (
  location: EncryptedFileLocation,
  name: string,
  value: string,
) {
  if (!isSecretName(name)) {
    return yield* new EncryptedFileError({ reason: "invalid-name", path: location.secretsPath });
  }
  if (value.trim().length === 0 || value.length > MAX_VALUE_LENGTH) {
    return yield* new EncryptedFileError({ reason: "invalid-value", path: location.secretsPath });
  }
  const secrets = yield* readSecrets(location);
  yield* writeSecrets(location, { ...secrets, [name]: value });
});

/** Whether the file held a secret with this name. */
export const removeSecret = Effect.fn("EncryptedFileStore.removeSecret")(function* (
  location: EncryptedFileLocation,
  name: string,
) {
  const secrets = yield* readSecrets(location);
  if (!Object.hasOwn(secrets, name)) return false;
  const { [name]: _removed, ...kept } = secrets;
  yield* writeSecrets(location, kept);
  return true;
});

export const listSecretNames = Effect.fn("EncryptedFileStore.listSecretNames")(function* (
  location: EncryptedFileLocation,
) {
  return Object.keys(yield* readSecrets(location)).toSorted();
});
