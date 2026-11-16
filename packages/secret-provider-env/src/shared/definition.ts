import { SecretProviderKind } from "@t3tools/contracts";
import { defineSecretProvider } from "@t3tools/secret-provider-core/shared/definition";
import * as Schema from "effect/Schema";

export const EnvSecretProviderConfig = Schema.Struct({});

const SCHEME = "env://";
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;

/** The variable `env://NAME` names, or undefined when it is not that syntax. */
export function parseEnvReference(reference: string): string | undefined {
  if (!reference.startsWith(SCHEME)) return undefined;
  const name = reference.slice(SCHEME.length);
  return NAME.test(name) ? name : undefined;
}

export const definition = defineSecretProvider({
  kind: SecretProviderKind.make("env"),
  label: "Environment variable",
  description:
    "Reads values from the environment Majordome's server was started with, such as the variables a container is given.",
  configSchema: EnvSecretProviderConfig,
  configFields: [],
  isReference: (reference) => parseEnvReference(reference) !== undefined,
  referencePlaceholder: "env://OPENAI_API_KEY",
  invalidReferenceMessage:
    "Use env://NAME, where NAME is the variable's name: letters, digits and underscores.",
});
