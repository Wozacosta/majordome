import { encryptedFileReference } from "@t3tools/secret-provider-encrypted-file/shared/definition";
import {
  encryptedFileLocation,
  listSecretNames,
  removeSecret,
  setSecret,
  type EncryptedFileError,
  type EncryptedFileLocation,
} from "@t3tools/secret-provider-encrypted-file/server/store";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, CliError, Command, GlobalFlag, Prompt } from "effect/cli";

import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

export class SecretCommandError extends Schema.TaggedError<SecretCommandError>()(
  "SecretCommandError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }

  override get [CliError.userMessage]() {
    return this.detail;
  }
}

const reported = <A, R>(effect: Effect.Effect<A, EncryptedFileError, R>) =>
  effect.pipe(Effect.mapError((error) => new SecretCommandError({ detail: error.message })));

const runForStore = Effect.fn("cli.secret.runForStore")(function* <A, E, R>(
  flags: { readonly baseDir: Parameters<typeof resolveCliAuthConfig>[0]["baseDir"] },
  run: (location: EncryptedFileLocation) => Effect.Effect<A, E, R>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
    quietLogs: true,
  });
  return yield* run(encryptedFileLocation(config.secretsDir, (yield* Path.Path).join));
});

// Typed at a hidden prompt, or piped in, so the value is never an argument: arguments end up in
// shell history and in the process list.
const readValue = Effect.fn("cli.secret.readValue")(function* (name: string) {
  const stdio = yield* Stdio.Stdio;
  if (yield* stdio.stdinIsTerminal) {
    return Redacted.value(yield* Prompt.run(Prompt.Hidden({ message: `Value for ${name}` })));
  }
  const piped = yield* stdio.stdin.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.mapError(() => new SecretCommandError({ detail: "Could not read the value." })),
  );
  // `echo` and editors end the text with one line break that is not part of the value.
  return piped.replace(/\r?\n$/, "");
});

const nameArgument = Argument.String("name").pipe(
  Argument.withDescription("The secret's name, such as openai."),
);

const setCommand = Command.make("set", { ...projectLocationFlags, name: nameArgument }).pipe(
  Command.withDescription(
    "Save a secret in the encrypted file. Type the value when asked, or pipe it in; never pass it as an argument.",
  ),
  Command.withHandler((flags) =>
    runForStore(flags, (location) =>
      Effect.gen(function* () {
        yield* reported(setSecret(location, flags.name, yield* readValue(flags.name)));
        yield* Console.log(
          [
            `Saved ${flags.name}.`,
            `In Majordome, pick your Encrypted file source next to a key field and enter ${encryptedFileReference(flags.name)}`,
            "If Majordome already uses this secret, select the check button beside it to read the new value.",
          ].join("\n"),
        );
      }),
    ),
  ),
);

const listCommand = Command.make("list", projectLocationFlags).pipe(
  Command.withDescription("List the names of the saved secrets. Values are never shown."),
  Command.withHandler((flags) =>
    runForStore(flags, (location) =>
      reported(listSecretNames(location)).pipe(
        Effect.flatMap((names) =>
          Console.log(
            names.length === 0
              ? "No secrets saved yet. Add one with `majord secret set <name>`."
              : names.join("\n"),
          ),
        ),
      ),
    ),
  ),
);

const removeCommand = Command.make("remove", { ...projectLocationFlags, name: nameArgument }).pipe(
  Command.withDescription("Delete a secret from the encrypted file."),
  Command.withHandler((flags) =>
    runForStore(flags, (location) =>
      reported(removeSecret(location, flags.name)).pipe(
        Effect.flatMap((removed) =>
          Console.log(
            removed ? `Removed ${flags.name}.` : `There is no secret named ${flags.name}.`,
          ),
        ),
      ),
    ),
  ),
);

export const secretCommand = Command.make("secret").pipe(
  Command.withDescription(
    "Manage the encrypted file of secrets on this server, for Settings → Secrets → Encrypted file.",
  ),
  Command.withSubcommands([setCommand, listCommand, removeCommand]),
);
