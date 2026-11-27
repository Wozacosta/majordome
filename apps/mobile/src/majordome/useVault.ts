import { useAtomValue } from "@effect/atom-react";
import type { MajordomeReadyTopic } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useMemo } from "react";

import { useProjects } from "../state/entities";
import { vaultTopicsAtom } from "./state";
import { finishedTopics, type FinishedTopic } from "./topic.logic";
import { topicRows, type TodayStore, type TopicRow } from "./today.logic";
import { updateTodayStore } from "./todayStore";

const sameRows = (left: ReadonlyArray<TopicRow>, right: ReadonlyArray<TopicRow>) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * The notes folder among the listed projects and its topics, or what this phone last saw of both
 * when the server cannot be reached. Finished topics are only known while it can.
 */
export function useVault(store: TodayStore | null): {
  readonly vault: TodayStore["vault"];
  readonly topics: ReadonlyArray<TopicRow>;
  readonly finished: ReadonlyArray<FinishedTopic>;
  /** The ready-made topics not added yet; none while the server cannot be reached. */
  readonly readyTopics: ReadonlyArray<MajordomeReadyTopic>;
} {
  const projects = useProjects().filter((project) => !project.archivedAt && !project.isScratch);
  const key = JSON.stringify(projects.map((project) => [project.environmentId, project.id]));
  const results = useAtomValue(vaultTopicsAtom(key));
  const index = results.findIndex(
    (result) => AsyncResult.getOrElse(result, () => null)?.isVault === true,
  );
  const found = index === -1 ? undefined : projects[index];
  const listed = index === -1 ? null : AsyncResult.getOrElse(results[index]!, () => null);
  const topics = listed ? topicRows(listed.topics) : null;
  const finishedKey = JSON.stringify(listed ? finishedTopics(listed.topics) : []);
  const readyKey = JSON.stringify(listed?.readyTopics ?? []);
  const foundEnvironmentId = found?.environmentId;
  const foundProjectId = found?.id;
  const topicsKey = topics === null ? null : JSON.stringify(topics);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the folder and its topics to the phone's file so they show offline
  useEffect(() => {
    if (foundEnvironmentId === undefined || foundProjectId === undefined || topicsKey === null) {
      return;
    }
    const rows = JSON.parse(topicsKey) as ReadonlyArray<TopicRow>;
    updateTodayStore((current) =>
      current.vault?.environmentId === foundEnvironmentId &&
      current.vault.projectId === foundProjectId &&
      sameRows(current.topics, rows)
        ? current
        : {
            ...current,
            vault: { environmentId: foundEnvironmentId, projectId: foundProjectId },
            topics: rows,
          },
    );
  }, [foundEnvironmentId, foundProjectId, topicsKey]);
  // The same rows by value keep one identity, so the lists drawn from them are not redrawn.
  const shownKey = found && topicsKey !== null ? topicsKey : JSON.stringify(store?.topics ?? []);
  const shown = useMemo(() => JSON.parse(shownKey) as ReadonlyArray<TopicRow>, [shownKey]);
  const finished = useMemo(
    () => JSON.parse(finishedKey) as ReadonlyArray<FinishedTopic>,
    [finishedKey],
  );
  const vaultKey = JSON.stringify(
    found ? { environmentId: found.environmentId, projectId: found.id } : (store?.vault ?? null),
  );
  const vault = useMemo(() => JSON.parse(vaultKey) as TodayStore["vault"], [vaultKey]);
  const readyTopics = useMemo(
    () => JSON.parse(readyKey) as ReadonlyArray<MajordomeReadyTopic>,
    [readyKey],
  );
  return { vault, topics: shown, finished, readyTopics };
}
