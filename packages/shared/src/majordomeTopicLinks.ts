import { appScreenHref, parseAppScreenHref } from "./appScreenLinks.ts";

/**
 * A link an assistant writes to name one of the owner's topics, such as `app://topic/fitness`.
 * A client that knows the topic draws it as the topic's badge; elsewhere the label is text.
 */
const TOPIC_PATH = /^\/topic\/([a-z0-9-]+)$/;

/** Null for an id a link cannot carry, such as one written by hand with other characters. */
export function topicHref(topicId: string): string | null {
  const href = appScreenHref(`/topic/${topicId}`);
  return parseTopicHref(href) === topicId ? href : null;
}

/** The topic's id; null for any other link. */
export function parseTopicHref(href: string): string | null {
  const path = parseAppScreenHref(href);
  return path === null ? null : (TOPIC_PATH.exec(path)?.[1] ?? null);
}

/** The Markdown an assistant is shown and asked to write; the bare title where no link can be made. */
export function formatTopicLink(title: string, topicId: string): string {
  const href = topicHref(topicId);
  return href === null ? title : `[${title.replaceAll(/[[\]]/g, "")}](${href})`;
}
