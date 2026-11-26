import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomeReadyRoutine, ProjectId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Section } from "./paper";
import { RoutineDrawing } from "./RoutineDrawings";

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** One routine to pick: a drawing of what it hands you, its name, and one sentence. */
function RoutineCard({
  drawing,
  title,
  sentence,
  note,
  busy = false,
  disabled = false,
  onPick,
}: {
  /** A ready-made routine's key, or `own`. */
  readonly drawing: string;
  readonly title: string;
  readonly sentence: string;
  /** What it needs first, or the topic it belongs to. */
  readonly note?: string | null;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onPick: () => void;
}) {
  return (
    <li className="flex">
      <button
        type="button"
        disabled={disabled}
        aria-busy={busy}
        onClick={onPick}
        className="flex w-full cursor-pointer flex-col rounded-xl border border-border bg-card p-1.5 text-left outline-none hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:opacity-60"
      >
        <span className="block overflow-hidden rounded-lg bg-muted/60">
          <RoutineDrawing routine={drawing} />
        </span>
        <span className="flex flex-col gap-1 px-1.5 pt-2.5 pb-1.5">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {title}
            {busy ? <Spinner size="sm" /> : null}
          </span>
          <span className="text-sm text-muted-foreground">{sentence}</span>
          {note ? <span className="text-xs text-muted-foreground/80">{note}</span> : null}
        </span>
      </button>
    </li>
  );
}

/**
 * Routines the owner can add in one click, read from the computer that runs their routines, as
 * picture cards; the last card is for one of their own. Nothing while there is no card to show.
 */
export function ReadyRoutines({
  environmentId,
  projectId,
  topicTitles,
  label,
  onOwn,
  fallback = null,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** By topic id, to say which topic a routine belongs to. */
  readonly topicTitles: ReadonlyMap<string, string>;
  readonly label: string;
  /** Starts a routine described in words; null where that cannot be done. */
  readonly onOwn: (() => void) | null;
  /** Shown in place of the cards when there are none. */
  readonly fallback?: ReactNode;
}) {
  const result = useAtomValue(
    majordomeEnvironment.readyRoutines({ environmentId, input: { projectId } }),
  );
  const canAdd = useAtomValue(majordomeEnvironment.addReadyRoutine.permissionAtom(environmentId));
  const openTopic = useAtomCommand(majordomeEnvironment.openTopic, {
    label: "open a topic",
    reportFailure: false,
  });
  const addReadyRoutine = useAtomCommand(majordomeEnvironment.addReadyRoutine, {
    label: "add a routine",
    reportFailure: false,
  });
  const [adding, setAdding] = useState<string | null>(null);
  // Asked again each time the page opens: empty until then, so nothing is offered twice.
  if (AsyncResult.isInitial(result)) return null;
  const routines = canAdd ? (AsyncResult.getOrElse(result, () => null)?.routines ?? []) : [];
  if (routines.length === 0 && onOwn === null) return fallback;

  const add = async (routine: MajordomeReadyRoutine) => {
    if (adding !== null) return;
    setAdding(routine.key);
    // A topic's routine posts in the topic's conversation; when that cannot start, in its own.
    const opened =
      routine.topicId === undefined
        ? null
        : await openTopic({ environmentId, input: { projectId, topicId: routine.topicId } });
    const added = await addReadyRoutine({
      environmentId,
      input: {
        projectId,
        key: routine.key,
        ...(opened?._tag === "Success" ? { threadId: opened.value.threadId } : {}),
      },
    });
    setAdding(null);
    if (added._tag === "Failure") {
      if (isAtomCommandInterrupted(added)) return;
      const failure = squashAtomCommandFailure(added);
      toastManager.add({
        type: "error",
        title: `Could not add “${routine.title}”`,
        description: failure instanceof Error ? failure.message : String(failure),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: `“${routine.title}” was added`,
      description: `It runs ${lowerFirst(routine.when)}.`,
    });
  };

  return (
    <Section label={label} className="@container">
      <ul aria-label={label} className="m-0 grid list-none grid-cols-2 gap-3 p-0 @xl:grid-cols-3">
        {routines.map((routine) => {
          const topic =
            routine.topicId === undefined ? undefined : topicTitles.get(routine.topicId);
          return (
            <RoutineCard
              key={routine.key}
              drawing={routine.key}
              title={routine.title}
              sentence={`${routine.when}, ${lowerFirst(routine.description)}`}
              note={
                [
                  routine.needs === undefined ? null : `Needs ${routine.needs} connected`,
                  topic === undefined ? null : `In your topic ${topic}`,
                ]
                  .filter((part) => part !== null)
                  .join(" · ") || null
              }
              busy={adding === routine.key}
              disabled={adding !== null}
              onPick={() => void add(routine)}
            />
          );
        })}
        {onOwn === null ? null : (
          <RoutineCard
            drawing="own"
            title="Your own"
            sentence="Tell the assistant what you'd like done, and when."
            onPick={onOwn}
          />
        )}
      </ul>
    </Section>
  );
}
