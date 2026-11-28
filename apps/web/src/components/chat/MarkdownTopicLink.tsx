import type { ReactNode } from "react";

import { TopicNameBadge } from "../majordome/TopicIcon";
import type { MajordomeVault, VaultTopic } from "../majordome/topics.logic";
import { useMajordomeVaults } from "../majordome/useMajordomeVaults";
import { useOpenTopic } from "../majordome/useOpenTopic";

/**
 * A topic the assistant named, as that topic's badge, which opens it. `label` is the link's
 * written text; an autolink has none, and takes the topic's own name. A topic this app does not
 * list, such as a removed one, still reads as the words written for it.
 */
export function MarkdownTopicLink(props: {
  readonly topicId: string;
  readonly label: ReactNode | null;
}) {
  const { vaults, activeVault } = useMajordomeVaults();
  const found = [activeVault, ...vaults].flatMap((vault) => {
    const topic = vault?.topics.find((candidate) => candidate.id === props.topicId);
    return vault && topic ? [{ vault, topic }] : [];
  })[0];
  if (found === undefined) return <span>{props.label}</span>;
  return <TopicLink vault={found.vault} topic={found.topic} label={props.label} />;
}

function TopicLink(props: {
  readonly vault: MajordomeVault;
  readonly topic: VaultTopic;
  readonly label: ReactNode | null;
}) {
  const openTopic = useOpenTopic(props.vault);
  return (
    <TopicNameBadge topic={props.topic} onOpen={() => void openTopic(props.topic)}>
      {props.label ?? props.topic.title}
    </TopicNameBadge>
  );
}
