import { parseTopicHref } from "@t3tools/shared/majordomeTopicLinks";

import { TOPIC_CHIP_ICON_SOURCES } from "../lib/contextChipIcons.generated";
import type { MarkdownLinkCustomization } from "../native/SelectableMarkdownText.types";
import type { TopicRow } from "./today.logic";
import { TONE_COLORS } from "./topicFaces";

/** A topic an assistant named, as a chip in the topic's colour with its icon. */
export function topicLinkCustomization(
  href: string,
  topics: ReadonlyArray<TopicRow>,
): MarkdownLinkCustomization | undefined {
  const topicId = parseTopicHref(href);
  const topic = topicId === null ? undefined : topics.find((row) => row.id === topicId);
  if (topic === undefined) return undefined;
  const tone = TONE_COLORS[topic.tone ?? "amber"];
  return {
    icon: TOPIC_CHIP_ICON_SOURCES[topic.icon ?? "hash"],
    // The tone at 15%, like the tile behind a topic's icon in the lists.
    chip: { accent: tone, tintsIcon: true, background: `${tone}26` },
  };
}
