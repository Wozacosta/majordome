import type {
  EnvironmentId,
  ExecutionEnvironmentPlatformOs,
  SecretProviderConfig,
  SecretProviderId,
  SecretProviderKind,
} from "@t3tools/contracts";
import type { SecretProviderConfigField } from "@t3tools/secret-provider-core/shared/definition";
import { builtInSecretProviderDefinitions } from "@t3tools/secret-provider-definitions/registry";
import * as Result from "effect/Result";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  draftFromSecretProvider,
  newSecretProviderDraft,
  secretProviderFromDraft,
  type SecretProviderDraft,
} from "./SecretProviderDialog.logic";
import { SecretProviderIcon } from "./secretProviderIcons";

const DEFINITIONS = builtInSecretProviderDefinitions.definitions;

function KindLabel({ kind, label }: { readonly kind: string; readonly label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <SecretProviderIcon kind={kind} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function ConfigFieldInput({
  field,
  value,
  error,
  onChange,
}: {
  readonly field: SecretProviderConfigField;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}) {
  const id = `secret-provider-${field.key}`;
  const shared = {
    id,
    value,
    placeholder: field.placeholder,
    spellCheck: false,
    "aria-invalid": error !== undefined,
    "aria-describedby": error !== undefined ? `${id}-error` : undefined,
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {field.input === "lines" ? (
        <Textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...shared} maxLength={1024} onChange={(event) => onChange(event.target.value)} />
      )}
      {error !== undefined ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {field.help !== undefined ? (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  );
}

/** Mounted per open, so each open starts from a fresh draft. */
export function SecretProviderDialog({
  onClose,
  environmentId,
  environmentLabel,
  environmentOs,
  existingIds,
  existing,
}: {
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly environmentOs: ExecutionEnvironmentPlatformOs | undefined;
  readonly existingIds: ReadonlySet<string>;
  readonly existing?: { readonly id: SecretProviderId; readonly config: SecretProviderConfig };
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [draft, setDraft] = useState<SecretProviderDraft>(() => {
    if (existing) return draftFromSecretProvider(existing.config);
    // Starts on a kind this server can read, so a Linux server does not open on the Keychain.
    const readable = DEFINITIONS.find(
      (candidate) =>
        environmentOs === undefined ||
        candidate.serverPlatforms === undefined ||
        candidate.serverPlatforms.includes(environmentOs),
    );
    return newSecretProviderDraft((readable ?? DEFINITIONS[0]!).kind);
  });
  const [submitted, setSubmitted] = useState(false);
  const definition = builtInSecretProviderDefinitions.find(draft.kind);
  const result = secretProviderFromDraft(
    draft,
    existingIds,
    existing ? { mode: "edit", id: existing.id } : { mode: "add" },
  );
  const issues = Result.isFailure(result) ? result.failure : { fields: {} };
  const nameError = submitted ? issues.name : undefined;
  const unreadableHere =
    definition?.serverPlatforms !== undefined &&
    environmentOs !== undefined &&
    !definition.serverPlatforms.includes(environmentOs);

  const save = () => {
    setSubmitted(true);
    if (Result.isFailure(result)) return;
    updateSettings({ secretProviders: { [result.success.id]: result.success.config } });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? `Edit ${existing.config.label}` : "Add a secret source"}
          </DialogTitle>
          <DialogDescription>
            Key and token fields in Settings can then read their value from it. Settings keep only
            the reference; the secret is read on {environmentLabel} when it is needed.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="secret-provider-form"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="secret-provider-kind">Where the secrets are</Label>
              <Select
                value={draft.kind}
                disabled={existing !== undefined}
                onValueChange={(next) => {
                  if (next !== null) setDraft({ ...draft, kind: next as SecretProviderKind });
                }}
              >
                <SelectTrigger id="secret-provider-kind" aria-label="Where the secrets are">
                  <SelectValue>
                    <KindLabel kind={draft.kind} label={definition?.label ?? draft.kind} />
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {DEFINITIONS.map((candidate) => (
                    <SelectItem key={candidate.kind} value={candidate.kind}>
                      <KindLabel kind={candidate.kind} label={candidate.label} />
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {definition !== undefined ? (
                <p className="text-xs text-muted-foreground">{definition.description}</p>
              ) : null}
              {unreadableHere ? (
                <Alert variant="warning">
                  <AlertDescription>
                    {definition.label} cannot be read on {environmentLabel}: its server runs on
                    another kind of computer.
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="secret-provider-name">Name</Label>
              <Input
                id="secret-provider-name"
                placeholder="My keys"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={64}
                aria-invalid={nameError !== undefined}
                aria-describedby={
                  nameError !== undefined ? "secret-provider-name-error" : undefined
                }
                autoFocus
              />
              {nameError !== undefined ? (
                <p
                  id="secret-provider-name-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {nameError}
                </p>
              ) : null}
            </div>
            {(definition?.configFields ?? []).map((field) => (
              <ConfigFieldInput
                key={`${draft.kind}:${field.key}`}
                field={field}
                value={draft.fields[field.key] ?? ""}
                error={submitted ? issues.fields[field.key] : undefined}
                onChange={(value) =>
                  setDraft({ ...draft, fields: { ...draft.fields, [field.key]: value } })
                }
              />
            ))}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="secret-provider-form"
            disabled={submitted && Result.isFailure(result)}
          >
            {existing ? "Save changes" : "Add source"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
