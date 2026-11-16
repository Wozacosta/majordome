import {
  SecretProviderId,
  SecretProviderLabel,
  type SecretProviderConfig,
  type SecretProviderKind,
} from "@t3tools/contracts";
import type {
  SecretProviderConfigField,
  SecretProviderDefinition,
} from "@t3tools/secret-provider-core/shared/definition";
import { builtInSecretProviderDefinitions } from "@t3tools/secret-provider-definitions/registry";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

const decodeSecretProviderId = Schema.decodeOption(SecretProviderId);
const decodeLabel = Schema.decodeResult(SecretProviderLabel);
const decodeFieldValue = new Map(
  builtInSecretProviderDefinitions.definitions.flatMap((definition) =>
    definition.configFields.map((field) => [field, Schema.decodeResult(field.schema)] as const),
  ),
);
const decodeConfigByKind = new Map(
  builtInSecretProviderDefinitions.definitions.map((definition) => [
    definition.kind as string,
    Schema.decodeUnknownOption(definition.configSchema),
  ]),
);

export type ClassifiedSecretProvider =
  | {
      readonly kind: "supported";
      readonly definition: SecretProviderDefinition;
      /** What the owner entered, for the list; hidden until revealed when `sensitive`. */
      readonly summary: { readonly text: string; readonly sensitive: boolean } | undefined;
    }
  | { readonly kind: "unsupported" };

const fieldText = (field: SecretProviderConfigField, config: unknown, separator: string) => {
  const value =
    typeof config === "object" && config !== null
      ? (config as Readonly<Record<string, unknown>>)[field.key]
      : undefined;
  if (Array.isArray(value)) return value.join(separator);
  return typeof value === "string" ? value : "";
};

/** Unknown kinds and configs that no longer decode are shown read-only; removal stays available. */
export function classifySecretProvider(provider: SecretProviderConfig): ClassifiedSecretProvider {
  const definition = builtInSecretProviderDefinitions.find(provider.kind);
  if (
    definition === undefined ||
    decodeConfigByKind.get(definition.kind)?.(provider.config)._tag !== "Some"
  ) {
    return { kind: "unsupported" };
  }
  const text = definition.configFields
    .map((field) => fieldText(field, provider.config, " "))
    .filter((part) => part.length > 0)
    .join(" ");
  return {
    kind: "supported",
    definition,
    summary:
      text.length === 0
        ? undefined
        : { text, sensitive: definition.configFields.some((field) => field.sensitive === true) },
  };
}

/** Stable and readable in settings.json, so re-adding a provider under the same name restores its variables. */
function secretProviderIdFromName(name: string): SecretProviderId | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/, "");
  return Option.getOrNull(decodeSecretProviderId(slug));
}

export interface SecretProviderDraft {
  readonly name: string;
  readonly kind: SecretProviderKind;
  /** What each of the kind's fields holds, as typed, by field key. */
  readonly fields: Readonly<Record<string, string>>;
}

export const newSecretProviderDraft = (kind: SecretProviderKind): SecretProviderDraft => ({
  name: "",
  kind,
  fields: {},
});

export function draftFromSecretProvider(provider: SecretProviderConfig): SecretProviderDraft {
  const definition = builtInSecretProviderDefinitions.find(provider.kind);
  return {
    name: provider.label,
    kind: provider.kind,
    fields: Object.fromEntries(
      (definition?.configFields ?? []).map((field) => [
        field.key,
        fieldText(field, provider.config, "\n"),
      ]),
    ),
  };
}

export type SecretProviderTarget =
  | { readonly mode: "add" }
  | { readonly mode: "edit"; readonly id: SecretProviderId };

export interface SecretProviderDraftIssues {
  readonly name?: string;
  /** One message per blocked field, by field key. */
  readonly fields: Readonly<Record<string, string>>;
}

function decodeName(value: string): Result.Result<string, string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return Result.fail("Enter a name.");
  return Result.mapError(decodeLabel(trimmed), (error) => error.message);
}

/** The value a field contributes to the config; `undefined` when an optional field is left empty. */
function decodeField(
  field: SecretProviderConfigField,
  typed: string,
): Result.Result<unknown, string> {
  const entered =
    field.input === "lines"
      ? typed
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : typed.trim();
  if (entered.length === 0) {
    return field.emptyMessage === undefined
      ? Result.succeed(undefined)
      : Result.fail(field.emptyMessage);
  }
  const decode = decodeFieldValue.get(field);
  if (decode === undefined) return Result.succeed(entered);
  return Result.mapError(decode(entered), (error) => error.message);
}

/** The settings entry a draft adds or replaces, or every field that blocks it, one message each. */
export function secretProviderFromDraft(
  draft: SecretProviderDraft,
  existingIds: ReadonlySet<string>,
  target: SecretProviderTarget,
): Result.Result<
  { readonly id: SecretProviderId; readonly config: SecretProviderConfig },
  SecretProviderDraftIssues
> {
  const label = decodeName(draft.name);
  let id: SecretProviderId | null = null;
  let nameIssue: string | undefined;
  if (Result.isFailure(label)) {
    nameIssue = label.failure;
  } else {
    id = target.mode === "edit" ? target.id : secretProviderIdFromName(label.success);
    if (id === null) nameIssue = "The name needs at least one letter or digit.";
    else if (target.mode === "add" && existingIds.has(id))
      nameIssue = "A secret source with this name exists.";
  }

  const definition = builtInSecretProviderDefinitions.find(draft.kind);
  const config: Record<string, unknown> = {};
  const fieldIssues: Record<string, string> = {};
  for (const field of definition?.configFields ?? []) {
    const value = decodeField(field, draft.fields[field.key] ?? "");
    if (Result.isFailure(value)) fieldIssues[field.key] = value.failure;
    else if (value.success !== undefined) config[field.key] = value.success;
  }

  if (
    definition === undefined ||
    id === null ||
    nameIssue !== undefined ||
    Result.isFailure(label) ||
    Object.keys(fieldIssues).length > 0
  ) {
    return Result.fail({
      ...(nameIssue === undefined ? {} : { name: nameIssue }),
      fields: fieldIssues,
    });
  }
  return Result.succeed({
    id,
    config: { kind: definition.kind, label: label.success, config },
  });
}
