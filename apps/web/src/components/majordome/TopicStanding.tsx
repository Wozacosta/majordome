import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { notesLink } from "./notes.logic";
import { useTopicChat } from "./TopicStarters";
import { standingCollapsed, standingFirstLine } from "./TopicStarters.logic";

const COLLAPSED_STORAGE_KEY = "majordome:topic-standing-collapsed";
const CollapsedChoices = Schema.Record(Schema.String, Schema.Boolean);
const NO_CHOICES: Readonly<Record<string, boolean>> = {};

const LABEL = "Where things stand";

const LOG_LINK_CLASS =
  "shrink-0 rounded-sm text-xs text-muted-foreground underline decoration-border underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// The side panel's quiet section label.
const LABEL_CLASS = "shrink-0 text-2xs font-medium text-muted-foreground leading-6 select-none";

/**
 * Where a topic stands, pinned above its main chat: the few lines the assistant keeps at the top
 * of the topic's log. Nothing for any other chat, or before the assistant has written them.
 */
export function TopicStanding({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const found = useTopicChat(environmentId, threadId);
  const narrow = useMediaQuery("max-sm");
  const [choices, setChoices] = useLocalStorage(
    COLLAPSED_STORAGE_KEY,
    NO_CHOICES,
    CollapsedChoices,
  );
  const standing = found?.topic.standing;
  if (!found || !standing || standing.text.trim() === "") return null;
  const { topic } = found;
  const collapsed = standingCollapsed(choices, topic.id, narrow);
  const log = (
    <Link
      {...notesLink({
        projectId: found.projectId,
        environmentId,
        path: topic.keyNote ?? undefined,
      })}
      className={LOG_LINK_CLASS}
    >
      Open the log
    </Link>
  );
  return (
    <section
      aria-label={`Where things stand with ${topic.title}`}
      data-topic-standing={collapsed ? "collapsed" : "open"}
      className="chat-composer-lane shrink-0 border-border/60 border-b bg-background"
    >
      <div className="mx-auto flex w-full max-w-(--chat-content-max-width) items-start gap-1.5 py-1.5">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show where things stand" : "Show less"}
          onClick={() => setChoices((current) => ({ ...current, [topic.id]: !collapsed }))}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
        </Button>
        {collapsed ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <span className={cn(LABEL_CLASS, "max-sm:leading-5")}>{LABEL}</span>
              <p className="min-w-0 truncate text-sm text-foreground leading-6 sm:flex-1">
                {standingFirstLine(standing.text)}
              </p>
            </div>
            <span className="leading-6">{log}</span>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <p className={LABEL_CLASS}>{LABEL}</p>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-foreground leading-6">
              {standing.text.trim()}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground leading-5">
              {standing.updatedAt ? <UpdatedLabel timestamp={standing.updatedAt} /> : null}
              {log}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// Its own component, so only the label re-renders each minute.
function UpdatedLabel({ timestamp }: { readonly timestamp: string }) {
  const nowMinute = useNowMinute();
  const label = formatRelativeTimeLabel(timestamp, Date.parse(`${nowMinute}:00.000Z`));
  return label === "" ? null : <span>Updated {label}</span>;
}
