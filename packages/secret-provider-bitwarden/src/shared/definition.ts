import { SecretProviderKind } from "@t3tools/contracts";
import { defineSecretProvider } from "@t3tools/secret-provider-core/shared/definition";
import * as Schema from "effect/Schema";

const TOKEN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The name, in Majordome's own key file, of the key that holds the machine account's access token. */
export const BitwardenTokenName = Schema.String.check(
  Schema.makeFilter((value: string) =>
    TOKEN_NAME.test(value)
      ? true
      : "Enter the name the access token is saved under: letters, digits, and . _ or -.",
  ),
);

/** Empty for Bitwarden's US cloud. It is passed to the CLI as an argument, so it is a plain https address. */
export const BitwardenServerUrl = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.makeFilter((value: string) =>
    value === "" || /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/.test(value)
      ? true
      : "Enter an https address, such as https://vault.bitwarden.eu, or leave it empty.",
  ),
);

export const BitwardenSecretProviderConfig = Schema.Struct({
  tokenName: BitwardenTokenName,
  serverUrl: Schema.optionalKey(BitwardenServerUrl),
});
export type BitwardenSecretProviderConfig = typeof BitwardenSecretProviderConfig.Type;

const SCHEME = "bws://";
const SECRET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The secret ID `bws://<id>` names, or undefined when it is not that syntax. */
export function parseBitwardenReference(reference: string): string | undefined {
  if (!reference.startsWith(SCHEME)) return undefined;
  const id = reference.slice(SCHEME.length);
  return SECRET_ID.test(id) ? id : undefined;
}

export const definition = defineSecretProvider({
  kind: SecretProviderKind.make("bitwarden_secrets_manager"),
  label: "Bitwarden Secrets Manager",
  description:
    "Reads secrets from Bitwarden Secrets Manager with the bws CLI, which must be installed on the server. It signs in with a machine account's access token, so it works on a server nobody is sitting at. This is not the Bitwarden password manager.",
  configSchema: BitwardenSecretProviderConfig,
  configFields: [
    {
      key: "tokenName",
      label: "Access token's name",
      input: "text",
      schema: BitwardenTokenName,
      emptyMessage: "Enter the name the access token is saved under.",
      placeholder: "bitwarden",
      help: "Save the machine account's access token first, above under Keys your assistant can use (or with majord secret set bitwarden), then enter its name here. Your assistant cannot take that key.",
    },
    {
      key: "serverUrl",
      label: "Server (optional)",
      input: "text",
      schema: BitwardenServerUrl,
      placeholder: "https://vault.bitwarden.eu",
      help: "Leave empty for bitwarden.com. Enter https://vault.bitwarden.eu for the EU cloud, or your own server's address.",
    },
  ],
  isReference: (reference) => parseBitwardenReference(reference) !== undefined,
  referencePlaceholder: "bws://2863ced6-eba1-48b4-b5c0-afa30104877a",
  invalidReferenceMessage:
    "Use bws:// followed by the secret's ID, which Bitwarden copies with Copy secret ID.",
});
