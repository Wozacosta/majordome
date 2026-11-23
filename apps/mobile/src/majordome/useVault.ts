import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";

import { useProjects } from "../state/entities";
import { vaultTopicsAtom } from "./state";
import { topicRows, type TodayStore, type TopicRow } from "./today.logic";
import { updateTodayStore } from "./todayStore";

const sameRows = (left: ReadonlyArray<TopicRow>, right: ReadonlyArray<TopicRow>) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * The notes folder among the listed projects and its topics, or what this phone last saw of both
 * when the server cannot be reached.
 */
export function useVault(store: TodayStore | null): {
  readonly vault: TodayStore["vault"];
  readonly topics: ReadonlyArray<TopicRow>;
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
  return found && topics
    ? { vault: { environmentId: found.environmentId, projectId: found.id }, topics }
    : { vault: store?.vault ?? null, topics: store?.topics ?? [] };
}
