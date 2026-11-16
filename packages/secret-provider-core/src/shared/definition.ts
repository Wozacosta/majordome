import type { ExecutionEnvironmentPlatformOs, SecretProviderKind } from "@t3tools/contracts";
import type * as Schema from "effect/Schema";

/** One setting the owner fills in when adding a provider of this kind. */
export interface SecretProviderConfigField {
  /** The key in the kind's config. */
  readonly key: string;
  readonly label: string;
  /** `lines` is a list of strings, entered one per line. */
  readonly input: "text" | "lines";
  /** Checks the entered value: a trimmed string, or the non-empty lines. */
  readonly schema: Schema.Codec<unknown, unknown>;
  /** Set when the field cannot be left empty. */
  readonly emptyMessage?: string;
  readonly placeholder?: string;
  readonly help?: string;
  /** Hidden in lists until the owner reveals it. */
  readonly sensitive?: boolean;
}

/** What clients and the server both need to know about one kind of secret provider. */
export interface SecretProviderDefinition<Config = unknown> {
  readonly kind: SecretProviderKind;
  readonly label: string;
  /** Where the secrets live and how to put one there, for someone choosing a kind. */
  readonly description: string;
  readonly configSchema: Schema.Codec<Config, unknown>;
  readonly configFields: ReadonlyArray<SecretProviderConfigField>;
  /** Set when only a server on one of these systems can read this kind. */
  readonly serverPlatforms?: ReadonlyArray<ExecutionEnvironmentPlatformOs>;
  /** Whether `reference` is syntax this kind can read. */
  readonly isReference: (reference: string) => boolean;
  readonly referencePlaceholder: string;
  readonly invalidReferenceMessage: string;
}

export const defineSecretProvider = <Config>(
  definition: SecretProviderDefinition<Config>,
): SecretProviderDefinition<Config> => definition;

export interface SecretProviderDefinitionRegistry {
  readonly definitions: ReadonlyArray<SecretProviderDefinition>;
  readonly find: (kind: string) => SecretProviderDefinition | undefined;
}

export function makeSecretProviderDefinitionRegistry(
  definitions: ReadonlyArray<SecretProviderDefinition>,
): SecretProviderDefinitionRegistry {
  const byKind = new Map<string, SecretProviderDefinition>();
  for (const definition of definitions) {
    if (byKind.has(definition.kind)) {
      throw new Error(`Secret provider '${definition.kind}' is defined more than once.`);
    }
    byKind.set(definition.kind, definition);
  }
  return { definitions, find: (kind) => byKind.get(kind) };
}
