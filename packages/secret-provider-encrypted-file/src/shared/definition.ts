import { SecretProviderKind } from "@t3tools/contracts";
import { defineSecretProvider } from "@t3tools/secret-provider-core/shared/definition";
import * as Schema from "effect/Schema";

export const EncryptedFileSecretProviderConfig = Schema.Struct({});

const SCHEME = "secret://";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Whether `name` can name a secret in the file: it is also typed on a command line. */
export const isSecretName = (name: string) => NAME.test(name);

/** The secret `secret://<name>` names, or undefined when it is not that syntax. */
export function parseEncryptedFileReference(reference: string): string | undefined {
  if (!reference.startsWith(SCHEME)) return undefined;
  const name = reference.slice(SCHEME.length);
  return isSecretName(name) ? name : undefined;
}

export const encryptedFileReference = (name: string) => `${SCHEME}${name}`;

export const definition = defineSecretProvider({
  kind: SecretProviderKind.make("encrypted_file"),
  label: "Encrypted file",
  description:
    "Keeps secrets in one encrypted file on Majordome's server, for a server that has no Keychain. Add a secret from the server's terminal with: majord secret set NAME",
  configSchema: EncryptedFileSecretProviderConfig,
  configFields: [],
  isReference: (reference) => parseEncryptedFileReference(reference) !== undefined,
  referencePlaceholder: "secret://openai",
  invalidReferenceMessage:
    "Use secret://name, with the name you gave to majord secret set: letters, digits, and . _ or -.",
});
