import { useState } from "react";

import { threadLinkMatcher } from "../ThreadLinkPicker.logic";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { TopicIconBadge } from "./TopicIcon";
import type { VaultTopic } from "./topics.logic";

/** Finds a topic by name and opens it: type a few letters, then Enter. */
export function TopicSearchDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** In the order to offer them. */
  readonly topics: ReadonlyArray<VaultTopic>;
  readonly onChoose: (topic: VaultTopic) => void;
}) {
  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      <CommandDialogPopup aria-label="Go to a topic">
        <TopicSearch
          topics={props.topics}
          onChoose={(topic) => {
            props.onOpenChange(false);
            props.onChoose(topic);
          }}
        />
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function TopicSearch(props: {
  readonly topics: ReadonlyArray<VaultTopic>;
  readonly onChoose: (topic: VaultTopic) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = threadLinkMatcher(query);
  const found = props.topics.filter((topic) => matches(topic.title));
  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label="Go to a topic">
      <CommandInput placeholder="Go to a topic…" />
      <CommandList className="max-h-80 overflow-y-auto">
        {found.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No topic with that name.
          </div>
        ) : (
          found.map((topic) => (
            <CommandItem key={topic.id} value={topic.id} onClick={() => props.onChoose(topic)}>
              <TopicIconBadge topic={topic} statusDotClass={null} />
              <span className="min-w-0 flex-1 truncate">{topic.title}</span>
              {topic.finishedAt === undefined ? null : (
                <span className="text-xs text-muted-foreground">Done</span>
              )}
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
}
