import { SecretProviderKind } from "@t3tools/contracts";
import { defineSecretProvider } from "@t3tools/secret-provider-core/shared/definition";
import * as Schema from "effect/Schema";

export const KeychainSecretProviderConfig = Schema.Struct({});

// A space is allowed inside a name; `/`, `%` and anything else is written percent-encoded.
const PART = String.raw`(?:[A-Za-z0-9._~@+-]|%[0-9A-Fa-f]{2})(?:(?:[A-Za-z0-9._~@+ -]|%[0-9A-Fa-f]{2})*(?:[A-Za-z0-9._~@+-]|%[0-9A-Fa-f]{2}))?`;
const REFERENCE = new RegExp(String.raw`^keychain://(${PART})/(${PART})$`);
const MAX_REFERENCE_LENGTH = 512;
// Tabs, line breaks, NUL and the like never belong in a Keychain item's name.
const CONTROL_CHARACTER = /\p{Cc}/u;

function decodePart(part: string): string | undefined {
  try {
    const decoded = decodeURIComponent(part);
    return CONTROL_CHARACTER.test(decoded) ? undefined : decoded;
  } catch {
    return undefined;
  }
}

/** The Keychain item `keychain://<service>/<account>` names, or undefined when it is not that syntax. */
export function parseKeychainReference(
  reference: string,
): { readonly service: string; readonly account: string } | undefined {
  if (reference.length > MAX_REFERENCE_LENGTH) return undefined;
  const match = REFERENCE.exec(reference);
  if (match === null) return undefined;
  const service = decodePart(match[1]!);
  const account = decodePart(match[2]!);
  return service === undefined || account === undefined ? undefined : { service, account };
}

export const definition = defineSecretProvider({
  kind: SecretProviderKind.make("keychain"),
  label: "Mac Keychain",
  description:
    "Reads passwords saved in the Keychain of the Mac that runs Majordome. It only works when Majordome's server is on a Mac.",
  configSchema: KeychainSecretProviderConfig,
  configFields: [],
  serverPlatforms: ["darwin"],
  isReference: (reference) => parseKeychainReference(reference) !== undefined,
  referencePlaceholder: "keychain://Majordome/openai",
  invalidReferenceMessage:
    "Use keychain://name/account, with the item's name and account as Keychain Access shows them.",
});
