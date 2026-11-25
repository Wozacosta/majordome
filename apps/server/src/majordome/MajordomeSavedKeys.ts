/**
 * The keys the owner saved for the assistant on this server: the encrypted key file
 * (`majord secret`), listed by name, with what each is for and when it was last used.
 *
 * A saved key is a standing yes: an assistant takes one without a card. It gets a file to read
 * inside one command, never the value, so the key stays out of the conversation and its log.
 */

import {
  type MajordomeSavedKey,
  MajordomeSavedKeysError,
  type MajordomeSavedKeysResult,
} from "@t3tools/contracts";
import {
  encryptedFileLocation,
  readSecrets,
  removeSecret,
  setSecret,
} from "@t3tools/secret-provider-encrypted-file/server/store";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

export class MajordomeSavedKeys extends Context.Service<
  MajordomeSavedKeys,
  {
    readonly list: () => Effect.Effect<MajordomeSavedKeysResult, MajordomeSavedKeysError>;
    /**
     * Adds a key, or replaces the one with that name. The value comes as text, or as a file a
     * secret request wrote, which is how an assistant saves a key it never saw.
     */
    readonly save: (
      input: {
        readonly name: string;
        readonly note?: string | undefined;
      } & ({ readonly value: string } | { readonly file: string }),
    ) => Effect.Effect<MajordomeSavedKey, MajordomeSavedKeysError>;
    readonly remove: (input: {
      readonly name: string;
    }) => Effect.Effect<void, MajordomeSavedKeysError>;
    /**
     * Writes the key to an owner-only file for one command. None when no key has that name. The
     * file is swept with the secret request files, a day later at most.
     */
    readonly use: (input: {
      readonly name: string;
    }) => Effect.Effect<Option.Option<{ readonly file: string }>, MajordomeSavedKeysError>;
  }
>()("t3/majordome/MajordomeSavedKeys") {}

const KeyNotes = Schema.Record(
  Schema.String,
  Schema.Struct({
    note: Schema.String,
    addedAt: Schema.optional(Schema.String),
    lastUsedAt: Schema.optional(Schema.String),
  }),
);
type KeyNotes = typeof KeyNotes.Type;
const KeyNotesJson = Schema.fromJsonString(KeyNotes);
const decodeNotes = Schema.decodeUnknownOption(KeyNotesJson);
const encodeNotes = Schema.encodeSync(KeyNotesJson);

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const location = encryptedFileLocation(config.secretsDir, path.join);
  // What each key is for sits outside the encrypted file, which the terminal command also writes.
  const notesPath = path.join(config.stateDir, "majordome", "saved-keys.json");
  // SecretRequests sweeps this directory hourly: a file named by 32 hex digits goes after a day.
  const filesDir = path.join(config.secretsDir, "files");
  // The key file is read, changed and written whole: one writer at a time.
  const lock = yield* Semaphore.make(1);

  const withStore = <A, E>(
    effect: Effect.Effect<A, E, FileSystem.FileSystem | SecureRandom.SecureRandom>,
  ) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(SecureRandom.SecureRandom, random),
      Effect.mapError((error) => new MajordomeSavedKeysError({ message: messageOf(error) })),
    );

  const readNotes = fileSystem.readFileString(notesPath).pipe(
    Effect.option,
    Effect.map((text) => Option.getOrElse(Option.flatMap(text, decodeNotes), (): KeyNotes => ({}))),
  );

  const writeNotes = Effect.fn("MajordomeSavedKeys.writeNotes")(function* (notes: KeyNotes) {
    const temporary = `${notesPath}.${yield* random.uuidV4()}.tmp`;
    yield* fileSystem.makeDirectory(path.dirname(notesPath), { recursive: true });
    yield* fileSystem.writeFileString(temporary, encodeNotes(notes));
    yield* fileSystem.rename(temporary, notesPath);
  }, Effect.ignore);

  const describe = (name: string, notes: KeyNotes): MajordomeSavedKey => {
    const known = notes[name];
    const stamp = (value: string | undefined) =>
      value === undefined
        ? undefined
        : Option.getOrUndefined(Option.map(DateTime.make(value), DateTime.formatIso));
    const addedAt = stamp(known?.addedAt);
    const lastUsedAt = stamp(known?.lastUsedAt);
    return {
      name,
      note: known?.note ?? "",
      ...(addedAt === undefined ? {} : { addedAt }),
      ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
    };
  };

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const list: MajordomeSavedKeys["Service"]["list"] = Effect.fn("MajordomeSavedKeys.list")(
    function* () {
      const names = Object.keys(yield* withStore(readSecrets(location))).sort();
      const notes = yield* readNotes;
      return { keys: names.map((name) => describe(name, notes)) };
    },
  );

  const save: MajordomeSavedKeys["Service"]["save"] = Effect.fn("MajordomeSavedKeys.save")(
    function* (input) {
      const value =
        "value" in input
          ? input.value
          : // Only a file a secret request wrote: never any other path on the server.
            path.dirname(path.resolve(input.file)) === filesDir
            ? yield* fileSystem.readFileString(input.file).pipe(Effect.orElseSucceed(() => ""))
            : "";
      yield* withStore(setSecret(location, input.name, value));
      const notes = yield* readNotes;
      const next: KeyNotes = {
        ...notes,
        [input.name]: {
          note: input.note?.trim() ?? notes[input.name]?.note ?? "",
          addedAt: yield* now,
        },
      };
      yield* writeNotes(next);
      return describe(input.name, next);
    },
    lock.withPermits(1),
  );

  const remove: MajordomeSavedKeys["Service"]["remove"] = Effect.fn("MajordomeSavedKeys.remove")(
    function* (input) {
      yield* withStore(removeSecret(location, input.name));
      const { [input.name]: _removed, ...kept } = yield* readNotes;
      yield* writeNotes(kept);
    },
    lock.withPermits(1),
  );

  const use: MajordomeSavedKeys["Service"]["use"] = Effect.fn("MajordomeSavedKeys.use")(function* (
    input,
  ) {
    const secrets = yield* withStore(readSecrets(location));
    if (!Object.hasOwn(secrets, input.name)) return Option.none();
    const file = path.join(filesDir, (yield* random.uuidV4()).replaceAll("-", ""));
    yield* fileSystem.makeDirectory(filesDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(fileSystem.chmod(filesDir, 0o700)),
      // `wx` never follows or replaces an existing path.
      Effect.andThen(
        fileSystem.writeFileString(file, secrets[input.name]!, { flag: "wx", mode: 0o600 }),
      ),
      Effect.mapError(
        () => new MajordomeSavedKeysError({ message: "Could not hand over the key." }),
      ),
    );
    const notes = yield* readNotes;
    yield* writeNotes({
      ...notes,
      [input.name]: { note: "", ...notes[input.name], lastUsedAt: yield* now },
    });
    return Option.some({ file });
  }, lock.withPermits(1));

  return MajordomeSavedKeys.of({ list, save, remove, use });
});

/** The store's errors say what to do in the owner's words; anything else gets one plain line. */
const messageOf = (error: unknown) =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : "The saved keys could not be read.";

export const layer = Layer.effect(MajordomeSavedKeys, make);
