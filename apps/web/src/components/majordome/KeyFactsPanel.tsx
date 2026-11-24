import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { majordomeEnvironment } from "../../state/majordome";
import { InputGroup, InputGroupInput } from "../ui/input-group";
import { KeyFactRows } from "./KeyFactRow";
import { keyFactGroups, localDay, searchKeyFacts } from "./keyFacts.logic";

/** Every key fact of a conversation, beside its chat: searchable, by kind, the days that are over last. */
export function KeyFactsPanel({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const result = useAtomValue(
    majordomeEnvironment.keyFacts({ environmentId, input: { threadId } }),
  );
  const [typed, setTyped] = useState("");
  const [today] = useState(() => localDay(new Date()));
  const data = AsyncResult.getOrElse(result, () => null);
  const all = keyFactGroups(data?.facts ?? [], { today });
  const groups = searchKeyFacts(all, typed);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-key-facts-panel="">
      <div className="border-b border-border/65 p-2">
        <InputGroup variant="ghost" className="h-7 min-w-0">
          <InputGroupInput
            type="search"
            name="key-facts-search"
            size="sm"
            value={typed}
            aria-label="Search key facts"
            placeholder="Search key facts"
            data-workspace-focus-default
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </InputGroup>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2.5 py-1 text-xs text-muted-foreground">
            {all.length > 0
              ? "Nothing matches."
              : data === null && result.waiting
                ? "Reading this chat…"
                : "Links, places, dates and names you mention are noted here after each reply."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.title} className="pb-2">
              <h3 className="px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {group.title}
              </h3>
              <KeyFactRows label={group.title} rows={group.rows} />
            </section>
          ))
        )}
      </div>
    </div>
  );
}
