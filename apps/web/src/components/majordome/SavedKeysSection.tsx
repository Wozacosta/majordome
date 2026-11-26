import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  MAJORDOME_SAVED_KEY_NOTE_MAX,
  type MajordomeSavedKey,
  type SecretProviderId,
} from "@t3tools/contracts";
import { builtInSecretProviderDefinitions } from "@t3tools/secret-provider-definitions/registry";
import {
  mergeSavedKeys,
  type SavedKeyEverywhere,
  savedKeyDayFrom,
  savedKeyExpiryLine,
  savedKeyLine,
  savedKeyNameFrom,
  savedKeyPlaceLine,
  savedKeyStanding,
} from "@t3tools/shared/majordomeSavedKeys";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  majordomeEnvironment,
  savedKeysOnAtom,
  savedKeysWritableOnAtom,
} from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { SecretSourceSelect, useSecretSources } from "../settings/SecretSourceInput";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { isUnknownRequest } from "./connections.logic";

const WORKS_UNTIL_PLACEHOLDER = "1 year, or 2027-11-25";
const WORKS_UNTIL_UNREADABLE =
  "Write a day, such as 2027-11-25, or how long it lasts, such as 1 year.";

/** What the typed last day comes to: nothing typed, a day, or text that is not one. */
function typedDay(typed: string, now: number) {
  if (typed.trim() === "") return { kind: "none" as const };
  const day = savedKeyDayFrom(typed, now);
  return day === null
    ? { kind: "unreadable" as const }
    : { kind: "day" as const, day, line: savedKeyExpiryLine({ expiresOn: day }, now) };
}

const failureMessage = (result: { readonly cause: Cause.Cause<unknown> }, fallback: string) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message !== "" ? error.message : fallback;
};

/** One of the owner's computers, named as it reads mid-sentence ("this Mac", "your server"). */
export interface KeyComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  /** Run by someone else, who could read what is kept on it. */
  readonly hosted: boolean;
}

type KeyRow = SavedKeyEverywhere<EnvironmentId>;

const namesOf = (computers: ReadonlyArray<KeyComputer>) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(
    computers.map((computer) => computer.name),
  );

/**
 * Makes one change on each computer at once. Answers with the computers it failed on and what
 * each said; `change` gives null when it worked.
 */
async function onEach(
  computers: ReadonlyArray<KeyComputer>,
  change: (environmentId: EnvironmentId) => Promise<string | null>,
) {
  const said = await Promise.all(computers.map((computer) => change(computer.environmentId)));
  return computers.flatMap((computer, index) => {
    const message = said[index];
    return message === null || message === undefined ? [] : [{ computer, message }];
  });
}

/**
 * The keys, tokens and passwords saved for the assistant, by name, as one list whichever of the
 * owner's computers holds them. A key is saved on all of `computers` and removed from all; a row
 * says where a key is only when it is not on every one. A value is never shown again once saved.
 */
export function SavedKeysSection({
  computers: listed,
  answers,
  sourcesOn,
}: {
  /** The connected computers that hold the notes, the one that answers the chats first. */
  readonly computers: ReadonlyArray<KeyComputer>;
  /** The computer that answers the chats, when it is known. */
  readonly answers: EnvironmentId | null;
  /** The computer whose secret sources the form offers: a source lives on one computer. */
  readonly sourcesOn: EnvironmentId;
}) {
  const listedKey = JSON.stringify(listed.map((computer) => computer.environmentId));
  const results = useAtomValue(savedKeysOnAtom(listedKey));
  const writable = useAtomValue(savedKeysWritableOnAtom(listedKey));
  const sourceKeys = majordomeEnvironment.savedKeys({ environmentId: sourcesOn, input: {} });
  const refresh = useAtomRefresh(sourceKeys);
  const sourcesKey = JSON.stringify(
    useEnvironmentSettings(sourcesOn, (settings) => settings.secretProviders),
  );
  const seenSourcesKey = useRef(sourcesKey);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the server says which key a source signs in with and names each key's source, so a changed source list asks it again
  useEffect(() => {
    if (seenSourcesKey.current === sourcesKey) return;
    seenSourcesKey.current = sourcesKey;
    refresh();
  }, [sourcesKey, seenSourcesKey, refresh]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<KeyRow | null>(null);
  const [dating, setDating] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  // A server from before saved keys is left out; with none left there is no section.
  const computers = listed.filter((_, index) => {
    const result = results[index];
    return !(
      result !== undefined &&
      result._tag === "Failure" &&
      AsyncResult.getOrElse(result, () => null) === null &&
      isUnknownRequest(Cause.squash(result.cause))
    );
  });
  if (computers.length === 0) return null;
  const read = computers.map((computer) => {
    const result = results[listed.indexOf(computer)];
    return {
      id: computer.environmentId,
      keys: result === undefined ? null : (AsyncResult.getOrElse(result, () => null)?.keys ?? null),
    };
  });
  const failed = computers.flatMap((computer) => {
    const result = results[listed.indexOf(computer)];
    return result !== undefined &&
      result._tag === "Failure" &&
      AsyncResult.getOrElse(result, () => null) === null
      ? [{ computer, result }]
      : [];
  });
  const changeable = computers.filter((computer) => writable[listed.indexOf(computer)] === true);
  const canChange = changeable.length > 0;
  const data = read.every((computer) => computer.keys === null)
    ? null
    : { keys: mergeSavedKeys(read) };
  const nameOf = (environmentId: EnvironmentId) =>
    computers.find((computer) => computer.environmentId === environmentId)?.name ??
    "another computer";
  const holding = (row: KeyRow) =>
    changeable.filter((computer) => row.on.includes(computer.environmentId));
  return (
    <SettingsSection
      title="Keys your assistant can use"
      headerAction={
        canChange && !adding ? (
          <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon className="size-3" aria-hidden />
            Add a key
          </Button>
        ) : null
      }
    >
      {data === null ? (
        <SettingsRow
          title={failed.length > 0 ? "The saved keys couldn't be read." : "Reading…"}
          description={
            failed[0] === undefined ? undefined : failureMessage(failed[0].result, "Try again.")
          }
        />
      ) : data.keys.length === 0 && !adding ? (
        <SettingsRow
          title="No keys saved yet."
          description="Save an API key, a token or a password here, or give one to your assistant in a chat and ask it to keep it. It can then use the key without asking you for it each time."
        />
      ) : (
        data.keys.map((key) =>
          dating === key.name ? (
            <ExpiryForm
              key={key.name}
              computers={holding(key)}
              savedKey={key}
              onClose={() => setDating(null)}
            />
          ) : (
            <SettingsRow
              key={key.name}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <KeyRoundIcon className="size-4 shrink-0 text-foreground/80" aria-hidden />
                  <span className="min-w-0 wrap-anywhere">{key.name}</span>
                </span>
              }
              description={savedKeyLine(key, undefined, undefined, now)}
              status={
                [
                  savedKeyStanding(key, now) === "over"
                    ? "Past its last day. Make a new key where this one came from, then save it here again."
                    : savedKeyStanding(key, now) === "soon"
                      ? "Stops working soon. Renew it where it came from."
                      : null,
                  savedKeyPlaceLine(key, nameOf, answers),
                ]
                  .filter((line) => line !== null)
                  .join(" ") || undefined
              }
              control={
                holding(key).length > 0 ? (
                  <span className="flex items-center gap-1">
                    {key.signsInTo === undefined ? (
                      <Button size="xs" variant="ghost" onClick={() => setDating(key.name)}>
                        {key.expiresOn === undefined ? "Set last day" : "Change last day"}
                      </Button>
                    ) : null}
                    <Button size="xs" variant="ghost" onClick={() => setRemoving(key)}>
                      Remove
                    </Button>
                  </span>
                ) : null
              }
            />
          ),
        )
      )}
      {data !== null && failed.length > 0 ? (
        <SettingsRow
          title={`The keys on ${namesOf(failed.map((entry) => entry.computer))} couldn't be read.`}
          description="A key shown here may be there too."
        />
      ) : null}
      {adding ? (
        <AddKeyForm
          computers={changeable}
          sourcesOn={sourcesOn}
          taken={data?.keys.map((key) => key.name) ?? []}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
      >
        {removing ? (
          <RemoveKeyPopup
            key={removing.name}
            computers={holding(removing)}
            name={removing.name}
            onClose={() => setRemoving(null)}
          />
        ) : null}
      </AlertDialog>
    </SettingsSection>
  );
}

function AddKeyForm({
  computers,
  sourcesOn,
  taken,
  onClose,
}: {
  /** Where a pasted key is saved: every computer the owner may change. */
  readonly computers: ReadonlyArray<KeyComputer>;
  readonly sourcesOn: EnvironmentId;
  readonly taken: ReadonlyArray<string>;
  readonly onClose: () => void;
}) {
  const id = useId();
  const saveKey = useAtomCommand(majordomeEnvironment.saveKey, {
    label: "save key",
    reportFailure: false,
    reportDefect: false,
  });
  const [typedName, setTypedName] = useState("");
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const [worksUntil, setWorksUntil] = useState("");
  const [now] = useState(() => Date.now());
  const until = typedDay(worksUntil, now);
  // Where the key is: pasted here (null), or an item in one of this computer's secret sources.
  const sources = useSecretSources(sourcesOn);
  const [sourceId, setSourceId] = useState<SecretProviderId | null>(null);
  const source = sources.find((candidate) => candidate.id === sourceId);
  const sourceKind =
    source === undefined ? undefined : builtInSecretProviderDefinitions.find(source.kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = savedKeyNameFrom(typedName);
  const replaces = taken.includes(name);
  // A source is on one computer, so a key kept in it is saved there alone.
  const sourceComputer = computers.filter((computer) => computer.environmentId === sourcesOn);
  const targets = source === undefined ? computers : sourceComputer;
  const hosted = targets.filter((computer) => computer.hosted);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (name === "") return setError("Give the key a name, such as garmin.");
    const typed = value.trim();
    if (source === undefined && value === "") return setError("Paste the key.");
    if (source !== undefined && sourceKind?.isReference(typed) !== true) {
      return setError(sourceKind?.invalidReferenceMessage ?? `Say where it is in ${source.label}.`);
    }
    if (until.kind === "unreadable") return setError(WORKS_UNTIL_UNREADABLE);
    setBusy(true);
    setError(null);
    const failures = await onEach(targets, async (environmentId) => {
      const saved = await saveKey({
        environmentId,
        input: {
          name,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
          ...(until.kind === "day" ? { expiresOn: until.day } : {}),
          ...(source === undefined
            ? { value }
            : { reference: { provider: source.id, reference: typed } }),
        },
      });
      return saved._tag === "Failure" && !isAtomCommandInterrupted(saved)
        ? failureMessage(saved, "The key could not be saved. Try again.")
        : null;
    });
    setBusy(false);
    const first = failures[0];
    if (first !== undefined && failures.length === targets.length) return setError(first.message);
    const missed = failures.map((failure) => failure.computer);
    toastManager.add(
      first === undefined
        ? { type: "success", title: "Saved", description: name }
        : {
            type: "warning",
            title: `Saved, but not on ${namesOf(missed)}`,
            description: `${first.message} Save ${name} again when ${missed.length === 1 ? "it is" : "they are"} back.`,
          },
    );
    onClose();
  };

  return (
    <form
      className="flex flex-col gap-3 border-t border-border px-4 py-3"
      onSubmit={(event) => void submit(event)}
    >
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-name`}>
        Name
        <Input
          nativeInput
          id={`${id}-name`}
          autoFocus
          placeholder="garmin"
          value={typedName}
          disabled={busy}
          onChange={(event) => {
            setTypedName(event.target.value);
            setError(null);
          }}
        />
      </Label>
      {name !== "" && name !== typedName ? (
        <p className="text-xs text-muted-foreground">Saved as {name}.</p>
      ) : null}
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-note`}>
        What it is for (optional)
        <Input
          nativeInput
          id={`${id}-note`}
          maxLength={MAJORDOME_SAVED_KEY_NOTE_MAX}
          placeholder="Garmin Connect API token, to read my runs"
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </Label>
      {/* The picker sits outside the label: a label names one field. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-value`}>
          {source === undefined ? "The key" : `Where it is in ${source.label}`}
        </Label>
        <span className="flex items-center gap-2">
          {sources.length === 0 ? null : (
            <SecretSourceSelect
              value={sourceId}
              sources={sources}
              label="The key"
              disabled={busy}
              onValueChange={(next) => {
                setSourceId(next);
                setValue("");
                setError(null);
              }}
            />
          )}
          <Input
            nativeInput
            id={`${id}-value`}
            className="min-w-0 flex-1"
            type={source === undefined ? "password" : "text"}
            autoComplete="off"
            spellCheck={false}
            placeholder={sourceKind?.referencePlaceholder}
            value={value}
            disabled={busy}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
        </span>
      </div>
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-until`}>
        Works until (optional)
        <Input
          nativeInput
          id={`${id}-until`}
          placeholder={WORKS_UNTIL_PLACEHOLDER}
          value={worksUntil}
          disabled={busy}
          onChange={(event) => {
            setWorksUntil(event.target.value);
            setError(null);
          }}
        />
      </Label>
      {until.kind === "day" ? (
        <p className="text-xs text-muted-foreground">
          {until.line}. Your assistant tells you when that day is near.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {replaces
          ? `A key named ${name} is already saved. Saving replaces it.`
          : source !== undefined
            ? `Majordome keeps no copy: it reads the key from ${source.label} each time your assistant uses it, and checks now that it can.`
            : "Your assistant sees the name and what it is for. It uses the key in a command without the key appearing in the chat, and it is not shown here again."}
      </p>
      {source !== undefined && computers.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          It works only in chats answered on {namesOf(sourceComputer)}. Paste the key instead to
          have it on all your computers.
        </p>
      ) : source === undefined && computers.length > 1 ? (
        <p className="text-xs text-muted-foreground">
          Saved on {namesOf(computers)}.
          {hosted.length > 0 ? ` Whoever runs ${namesOf(hosted)} could read a key kept there.` : ""}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Spinner size="sm" /> : null}
          {replaces ? "Replace key" : "Save key"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Sets, changes or clears the last day a saved key works, in the key's own row. */
function ExpiryForm({
  computers,
  savedKey,
  onClose,
}: {
  /** The computers that hold the key: each keeps its own note of the day. */
  readonly computers: ReadonlyArray<KeyComputer>;
  readonly savedKey: MajordomeSavedKey;
  readonly onClose: () => void;
}) {
  const id = useId();
  const saveKey = useAtomCommand(majordomeEnvironment.saveKey, {
    label: "set key last day",
    reportFailure: false,
    reportDefect: false,
  });
  const [worksUntil, setWorksUntil] = useState(savedKey.expiresOn ?? "");
  const [now] = useState(() => Date.now());
  const until = typedDay(worksUntil, now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (expiresOn: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failures = await onEach(computers, async (environmentId) => {
      const saved = await saveKey({ environmentId, input: { name: savedKey.name, expiresOn } });
      return saved._tag === "Failure" && !isAtomCommandInterrupted(saved)
        ? failureMessage(saved, "The day could not be saved. Try again.")
        : null;
    });
    setBusy(false);
    const first = failures[0];
    if (first === undefined) return onClose();
    setError(
      failures.length === computers.length
        ? first.message
        : `Not saved on ${namesOf(failures.map((failure) => failure.computer))}: ${first.message}`,
    );
  };

  return (
    <form
      className="flex flex-col gap-3 border-t border-border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (until.kind === "day") void send(until.day);
        else
          setError(
            until.kind === "none"
              ? "Write the day, or choose No end date."
              : WORKS_UNTIL_UNREADABLE,
          );
      }}
    >
      <Label className="flex flex-col items-stretch" htmlFor={`${id}-until`}>
        {savedKey.name} works until
        <Input
          nativeInput
          id={`${id}-until`}
          autoFocus
          placeholder={WORKS_UNTIL_PLACEHOLDER}
          value={worksUntil}
          disabled={busy}
          onChange={(event) => {
            setWorksUntil(event.target.value);
            setError(null);
          }}
        />
      </Label>
      <p className="text-xs text-muted-foreground">
        {until.kind === "day" ? `${until.line}. ` : ""}
        Majordome does not stop the key that day: it tells you and your assistant that it is near.
      </p>
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Spinner size="sm" /> : null}
          Save
        </Button>
        {savedKey.expiresOn === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void send(null)}
          >
            No end date
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RemoveKeyPopup({
  computers,
  name,
  onClose,
}: {
  /** The computers that hold the key: it is removed from each. */
  readonly computers: ReadonlyArray<KeyComputer>;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const removeSavedKey = useAtomCommand(majordomeEnvironment.removeSavedKey, {
    label: "remove saved key",
    reportFailure: false,
    reportDefect: false,
  });
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const failures = await onEach(computers, async (environmentId) => {
      const result = await removeSavedKey({ environmentId, input: { name } });
      return result._tag === "Failure" && !isAtomCommandInterrupted(result)
        ? failureMessage(result, "Try again.")
        : null;
    });
    setBusy(false);
    const first = failures[0];
    if (first !== undefined) {
      toastManager.add({
        type: "error",
        title:
          failures.length === computers.length
            ? "Could not remove it"
            : `Still on ${namesOf(failures.map((failure) => failure.computer))}`,
        description: first.message,
      });
    }
    onClose();
  };
  return (
    <AlertDialogPopup>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove “{name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          Your assistant can no longer use this key
          {computers.length > 1 ? " on any of your computers" : ""}, and Majordome deletes its copy
          if it holds one. The key itself still works wherever it came from: cancel it there if it
          should stop working.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose disabled={busy} render={<Button variant="outline" disabled={busy} />}>
          Cancel
        </AlertDialogClose>
        <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {busy && <Spinner size="sm" />}
          Remove
        </Button>
      </AlertDialogFooter>
    </AlertDialogPopup>
  );
}
