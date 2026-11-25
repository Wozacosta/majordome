/**
 * The keys the owner saved for the assistant on this server, by name. A saved key is a standing
 * yes: an assistant takes one without a card, as a file to read inside one command, never the
 * value. A key is in the server's key file, or points at an item in a secret source.
 */

import {
  type MajordomeSavedKey,
  MajordomeSavedKeysError,
  type MajordomeSavedKeysResult,
  SecretReference,
} from "@t3tools/contracts";
import * as Bitwarden from "@t3tools/secret-provider-bitwarden/shared/definition";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import { isSecretName } from "@t3tools/secret-provider-encrypted-file/shared/definition";
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
import * as ServerSettings from "../serverSettings.ts";

export class MajordomeSavedKeys extends Context.Service<
  MajordomeSavedKeys,
  {
    readonly list: () => Effect.Effect<MajordomeSavedKeysResult, MajordomeSavedKeysError>;
    /**
     * Adds a key, or replaces the one with that name. The value comes as text, as a file a
     * secret request wrote, which is how an assistant saves a key it never saw, or as a reference
     * to an item in a secret source, which must be readable now.
     */
    readonly save: (
      input: {
        readonly name: string;
        readonly note?: string | undefined;
      } & (
        | { readonly value: string }
        | { readonly file: string }
        | { readonly reference: SecretReference }
      ),
    ) => Effect.Effect<MajordomeSavedKey, MajordomeSavedKeysError>;
    readonly remove: (input: {
      readonly name: string;
    }) => Effect.Effect<void, MajordomeSavedKeysError>;
    /**
     * Writes the key to an owner-only file for one command. None when no key has that name. The
     * file is swept with the secret request files, a day later at most. Fails for a key that
     * signs Majordome in to a secret source, and for one its source cannot read right now.
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
    /** Set for a key that lives in a secret source; the key file then holds nothing under the name. */
    reference: Schema.optional(SecretReference),
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
  const resolver = yield* SecretResolver.SecretResolver;
  const settings = yield* ServerSettings.ServerSettingsService;
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

  const isBitwardenConfig = Schema.is(Bitwarden.BitwardenSecretProviderConfig);

  /** The keys a secret source signs in with, by name, with that source's own name. */
  const signInKeys = settings.getSettings.pipe(
    Effect.map(
      ({ secretProviders }) =>
        new Map(
          Object.values(secretProviders).flatMap((provider) =>
            provider.kind === Bitwarden.definition.kind && isBitwardenConfig(provider.config)
              ? [[provider.config.tokenName, provider.label] as const]
              : [],
          ),
        ),
    ),
    Effect.orElseSucceed(() => new Map<string, string>()),
  );

  const describe = Effect.fn("MajordomeSavedKeys.describe")(function* (
    name: string,
    notes: KeyNotes,
    signIn: ReadonlyMap<string, string>,
  ) {
    const known = notes[name];
    const stamp = (value: string | undefined) =>
      value === undefined
        ? undefined
        : Option.getOrUndefined(Option.map(DateTime.make(value), DateTime.formatIso));
    const addedAt = stamp(known?.addedAt);
    const lastUsedAt = stamp(known?.lastUsedAt);
    const source =
      known?.reference === undefined ? undefined : yield* resolver.label(known.reference.provider);
    const signsInTo = signIn.get(name);
    return {
      name,
      note: known?.note ?? "",
      ...(addedAt === undefined ? {} : { addedAt }),
      ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
      ...(source === undefined ? {} : { source }),
      ...(signsInTo === undefined ? {} : { signsInTo }),
    } satisfies MajordomeSavedKey;
  });

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const list: MajordomeSavedKeys["Service"]["list"] = Effect.fn("MajordomeSavedKeys.list")(
    function* () {
      const held = Object.keys(yield* withStore(readSecrets(location)));
      const notes = yield* readNotes;
      const kept = Object.keys(notes).filter((name) => notes[name]?.reference !== undefined);
      const signIn = yield* signInKeys;
      return {
        keys: yield* Effect.forEach([...new Set([...held, ...kept])].sort(), (name) =>
          describe(name, notes, signIn),
        ),
      };
    },
  );

  const save: MajordomeSavedKeys["Service"]["save"] = Effect.fn("MajordomeSavedKeys.save")(
    function* (input) {
      const notes = yield* readNotes;
      const entry = {
        note: input.note?.trim() ?? notes[input.name]?.note ?? "",
        addedAt: yield* now,
      };
      if ("reference" in input) {
        if (!isSecretName(input.name)) {
          return yield* new MajordomeSavedKeysError({ message: INVALID_NAME });
        }
        const [read] = yield* resolver.read([input.reference], { fresh: true });
        if (read === undefined) {
          const source = yield* resolver.label(input.reference.provider);
          return yield* new MajordomeSavedKeysError({
            message: `Majordome couldn't read that from ${source}. Check what you entered, and that ${source} is set up on this computer.`,
          });
        }
        // One key per name: a copy Majordome held under it goes.
        yield* withStore(removeSecret(location, input.name));
        const next: KeyNotes = {
          ...notes,
          [input.name]: { ...entry, reference: input.reference },
        };
        yield* writeNotes(next);
        return yield* describe(input.name, next, yield* signInKeys);
      }
      const value =
        "value" in input
          ? input.value
          : // Only a file a secret request wrote: never any other path on the server.
            path.dirname(path.resolve(input.file)) === filesDir
            ? yield* fileSystem.readFileString(input.file).pipe(Effect.orElseSucceed(() => ""))
            : "";
      yield* withStore(setSecret(location, input.name, value));
      const next: KeyNotes = { ...notes, [input.name]: entry };
      yield* writeNotes(next);
      return yield* describe(input.name, next, yield* signInKeys);
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
    const signsInTo = (yield* signInKeys).get(input.name);
    if (signsInTo !== undefined) {
      return yield* new MajordomeSavedKeysError({
        message: `That key signs Majordome in to ${signsInTo}. It is not yours to take: use the keys kept in ${signsInTo} instead.`,
      });
    }
    const reference = (yield* readNotes)[input.name]?.reference;
    const secrets = yield* withStore(readSecrets(location));
    if (reference === undefined && !Object.hasOwn(secrets, input.name)) return Option.none();
    // Asked of the source each time, so a key changed there is the one used.
    const value =
      reference === undefined
        ? secrets[input.name]
        : (yield* resolver.read([reference], { fresh: true }))[0];
    if (value === undefined) {
      const source = reference === undefined ? "" : yield* resolver.label(reference.provider);
      return yield* new MajordomeSavedKeysError({
        message: `${source} could not be read right now, so the key is not available. Tell the owner.`,
      });
    }
    const file = path.join(filesDir, (yield* random.uuidV4()).replaceAll("-", ""));
    yield* fileSystem.makeDirectory(filesDir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(fileSystem.chmod(filesDir, 0o700)),
      // `wx` never follows or replaces an existing path.
      Effect.andThen(fileSystem.writeFileString(file, value, { flag: "wx", mode: 0o600 })),
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
const INVALID_NAME =
  "A key's name starts with a letter or digit and has only letters, digits, and . _ or -.";

const messageOf = (error: unknown) =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : "The saved keys could not be read.";

export const layer = Layer.effect(MajordomeSavedKeys, make);
