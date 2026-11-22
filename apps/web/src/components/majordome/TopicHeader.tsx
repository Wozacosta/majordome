import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { useQuietThreadShell } from "../../state/entities";
import { textDirection } from "../../textDirection";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { notesLink } from "./notes.logic";
import { topicOfThread } from "./topicFiles.logic";
import { TopicEditMenuItems, TopicFinishMenuItem, useTopicActions } from "./TopicHeaderActions";
import { TopicIconBadge } from "./TopicIcon";
import { topicHeaderFacts, type MajordomeVault, type VaultTopic } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

/**
 * The title of a chat that is a topic's conversation: the topic's icon and name, where its notes
 * are, and what can be done to the topic. Any other chat keeps `fallback`, its plain title.
 */
export function TopicHeader(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly fallback: ReactNode;
}) {
  // The chat's own server's copy: the folder linked is the one this conversation writes in.
  const { copies } = useMajordomeVaults();
  const found = topicOfThread(copies, props.environmentId, props.threadId);
  const vault =
    found === null
      ? undefined
      : copies.find(
          (copy) =>
            copy.environmentId === props.environmentId && copy.projectId === found.projectId,
        );
  if (found === null || vault === undefined) return props.fallback;
  return <TopicTitle vault={vault} topic={found.topic} threadId={props.threadId} />;
}

function TopicTitle({
  vault,
  topic,
  threadId,
}: {
  readonly vault: MajordomeVault;
  readonly topic: VaultTopic;
  readonly threadId: ThreadId;
}) {
  const actions = useTopicActions(vault);
  const thread = useQuietThreadShell(scopeThreadRef(vault.environmentId, threadId));
  const nowMinute = useNowMinute();
  const activity = thread === null ? null : resolveThreadActivityTimestamp(thread);
  const lastActivity =
    activity === null
      ? null
      : formatRelativeTimeLabel(activity, Date.parse(`${nowMinute}:00.000Z`));
  const finished = topic.finishedAt !== undefined;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <TopicIconBadge topic={topic} statusDotClass={null} className="size-7" />
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate text-sm leading-5" dir={textDirection(topic.title)}>
            {topic.title}
          </h2>
          {finished ? (
            <Badge variant="secondary" size="sm">
              Finished
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs leading-4 font-normal text-muted-foreground">
          <Link
            {...notesLink({
              projectId: vault.projectId,
              environmentId: vault.environmentId,
              path: topic.keyNote ?? undefined,
            })}
            className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Notes in {topic.folder}
          </Link>
          {topicHeaderFacts(topic, lastActivity)}
        </p>
      </div>
      {finished ? (
        <Button size="xs" variant="outline" onClick={() => void actions.setFinished(topic, false)}>
          Bring back
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger
          render={
            <Button size="icon-xs" variant="ghost-muted" aria-label={`More for ${topic.title}`} />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <TopicEditMenuItems topic={topic} actions={actions} />
          <MenuSeparator />
          <TopicFinishMenuItem topic={topic} actions={actions} />
        </MenuPopup>
      </Menu>
      {actions.dialogs}
    </div>
  );
}
