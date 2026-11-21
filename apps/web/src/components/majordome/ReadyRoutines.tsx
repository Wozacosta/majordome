import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, MajordomeReadyRoutine, ProjectId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Entry, EntryList, Section } from "./paper";

/**
 * Routines the owner can add in one step, read from the computer that runs their routines.
 * Nothing while there are none left to offer.
 */
export function ReadyRoutines({
  environmentId,
  projectId,
  topicTitles,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** By topic id, to say which topic a routine belongs to. */
  readonly topicTitles: ReadonlyMap<string, string>;
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
  const routines = AsyncResult.getOrElse(result, () => null)?.routines ?? [];
  if (routines.length === 0 || !canAdd) return null;

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
      description: `It runs ${routine.when.charAt(0).toLowerCase()}${routine.when.slice(1)}.`,
    });
  };

  return (
    <Section label="Ready-made routines">
      <EntryList aria-label="Ready-made routines">
        {routines.map((routine) => {
          const topic =
            routine.topicId === undefined ? undefined : topicTitles.get(routine.topicId);
          return (
            <Entry
              key={routine.key}
              title={routine.title}
              meta={[
                routine.when,
                topic === undefined ? null : `in your topic ${topic}`,
                routine.needs === undefined ? null : `needs ${routine.needs} connected`,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
              actions={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={adding !== null}
                  onClick={() => void add(routine)}
                >
                  {adding === routine.key ? <Spinner size="sm" /> : null}
                  Add
                </Button>
              }
            >
              <p className="text-muted-foreground">{routine.description}</p>
            </Entry>
          );
        })}
      </EntryList>
    </Section>
  );
}
