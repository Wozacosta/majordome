import { SecretProviderKind } from "@t3tools/contracts";
import { defineSecretProvider } from "@t3tools/secret-provider-core/shared/definition";
import * as Schema from "effect/Schema";

const CONTROL_CHARACTER = /\p{Cc}/u;

/** A program name or path. It is run directly, so it can never be read as an option. */
const ExecCommand = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((value: string) =>
    value.length > 0 && !value.startsWith("-") && !CONTROL_CHARACTER.test(value)
      ? true
      : "Enter the program's name or full path, such as /usr/local/bin/infisical.",
  ),
);

const ExecArgument = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((value: string) =>
    value.length > 0 && !CONTROL_CHARACTER.test(value)
      ? true
      : "Arguments are plain text, one per line.",
  ),
);

const ExecArguments = Schema.Array(ExecArgument).check(Schema.isMaxLength(32));

export const ExecSecretProviderConfig = Schema.Struct({
  command: ExecCommand,
  args: Schema.optionalKey(ExecArguments),
});

const SCHEME = "exec://";
// Every part starts with a letter, digit or underscore, so a name is never an option or `..`.
const PART = String.raw`[A-Za-z0-9_][A-Za-z0-9_.-]*`;
const NAME = new RegExp(String.raw`^${PART}(?:/${PART})*$`);
const MAX_NAME_LENGTH = 256;

/** The secret name `exec://<name>` hands to the program, or undefined when it is not that syntax. */
export function parseExecReference(reference: string): string | undefined {
  if (!reference.startsWith(SCHEME)) return undefined;
  const name = reference.slice(SCHEME.length);
  return name.length <= MAX_NAME_LENGTH && NAME.test(name) ? name : undefined;
}

export const definition = defineSecretProvider({
  kind: SecretProviderKind.make("exec"),
  label: "Command",
  description:
    "Runs a program on Majordome's server to fetch each secret, for tools such as Infisical, Doppler or pass. The secret's name is added as the last argument, and what the program prints is the secret.",
  configSchema: ExecSecretProviderConfig,
  configFields: [
    {
      key: "command",
      label: "Program",
      input: "text",
      schema: ExecCommand,
      emptyMessage: "Enter the program to run.",
      placeholder: "/usr/local/bin/infisical",
      help: "The program's name or, more safely, its full path on the server.",
    },
    {
      key: "args",
      label: "Arguments",
      input: "lines",
      schema: ExecArguments,
      placeholder: "secrets\nget\n--plain",
      help: "One per line, exactly as written: no quotes needed. The secret's name is added after them.",
    },
  ],
  isReference: (reference) => parseExecReference(reference) !== undefined,
  referencePlaceholder: "exec://OPENAI_API_KEY",
  invalidReferenceMessage:
    "Use exec://name, where the name has only letters, digits, and . _ - or / between them.",
});
