import { useAtomValue } from "@effect/atom-react";
import type { MajordomeNotesSearchResult } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { useDebouncedValue } from "../../state/queries";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import type { notesLink, NotesVault } from "./notes.logic";
import {
  NOTES_SEARCH_DEBOUNCE_MS,
  NOTES_SEARCH_LIMIT,
  notesSearchLocation,
  type NotesSearchNotice,
  notesSearchQuery,
  notesSearchShouldFallBack,
  notesSearchView,
  splitHighlights,
} from "./notesSearch.logic";
import { Entry, EntryList, EntryTitle, Muted, ROW_ACTION_CLASS, StatusLine } from "./paper";

const NO_SEARCH = Atom.make(AsyncResult.initial<MajordomeNotesSearchResult, never>(false)).pipe(
  Atom.withLabel("majordome:notes-search:none"),
);

/** The words to look for inside notes. The folder list's own box filters file names. */
export function NotesSearchField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon aria-hidden className="size-3.5" />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        name="notes-search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || value === "") return;
          event.preventDefault();
          onChange("");
        }}
        placeholder="Search in your notes"
        aria-label="Search in your notes"
        spellCheck={false}
        size="sm"
      />
    </InputGroup>
  );
}

function Notice({ notice }: { readonly notice: NotesSearchNotice | null }) {
  return notice === null ? null : (
    <StatusLine tone={notice.tone} className="pb-3 text-muted-foreground">
      {notice.text}
    </StatusLine>
  );
}

/**
 * The notes that hold what is typed, each a link to the note. Renders nothing while nothing is
 * typed. `copies` is the shown brain's copies in the order to ask them; give it a `key` per brain.
 */
export function NotesSearchResults({
  copies,
  typed,
  selectedPath,
  linkTo,
}: {
  readonly copies: ReadonlyArray<NotesVault>;
  readonly typed: string;
  readonly selectedPath: string | null;
  readonly linkTo: (copy: NotesVault, path: string) => ReturnType<typeof notesLink>;
}) {
  const query = notesSearchQuery(typed);
  const settled = useDebouncedValue(query, NOTES_SEARCH_DEBOUNCE_MS);
  // How many copies could not answer: an older server, or one that is unreachable.
  const [skipped, setSkipped] = useState(0);
  const copy = copies[Math.min(skipped, copies.length - 1)];
  // Leaving a query's atom stops its request, so only the latest one is ever answered.
  const result = useAtomValue(
    copy === undefined || settled === ""
      ? NO_SEARCH
      : majordomeEnvironment.notesSearch({
          environmentId: copy.environmentId,
          input: { projectId: copy.projectId, query: settled, limit: NOTES_SEARCH_LIMIT },
        }),
  );
  const answer = {
    data: AsyncResult.getOrElse(result, () => null),
    waiting: result.waiting,
    error: result._tag === "Failure" ? Cause.squash(result.cause) : null,
  };
  if (notesSearchShouldFallBack(answer) && skipped < copies.length - 1) setSkipped(skipped + 1);

  // Kept from earlier renders, so results stay up while the next ones load.
  const [previous, setPrevious] = useState<MajordomeNotesSearchResult | null>(null);
  const latest = query === "" ? null : (answer.data ?? previous);
  if (latest !== previous) setPrevious(latest);

  const view = notesSearchView({ typed, settled, answer, previous });
  if (view.kind === "idle" || copy === undefined) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" data-notes-search={view.kind}>
      {view.kind === "searching" ? (
        <Muted role="status">Searching…</Muted>
      ) : view.kind === "unavailable" ? (
        <Muted role="status">Update this server to search inside your notes.</Muted>
      ) : view.kind === "failed" ? (
        <Muted role="status">The search did not work. Try again in a moment.</Muted>
      ) : view.kind === "empty" ? (
        <>
          <Notice notice={view.notice} />
          <Muted role="status">No note holds these words.</Muted>
        </>
      ) : (
        <>
          <Notice notice={view.notice} />
          <EntryList className={cn(view.stale && "opacity-60")} aria-busy={view.stale}>
            {view.results.map((hit) => (
              <Entry key={hit.path} className="py-1.5">
                <Link
                  {...linkTo(copy, hit.path)}
                  className={cn(ROW_ACTION_CLASS, "flex min-w-0 flex-col gap-0.5 py-1.5")}
                  aria-current={hit.path === selectedPath ? "page" : undefined}
                  data-notes-search-result={hit.path}
                >
                  <EntryTitle className="break-words">{hit.title}</EntryTitle>
                  <span className="text-xs break-words text-muted-foreground">
                    {notesSearchLocation(hit)}
                  </span>
                  <span className="text-sm break-words text-muted-foreground">
                    {splitHighlights(hit.snippet, hit.highlights).map((part, index) =>
                      part.match ? (
                        // oxlint-disable-next-line react/no-array-index-key -- parts of one fixed string, never reordered
                        <mark key={index} className="bg-transparent font-semibold text-foreground">
                          {part.text}
                        </mark>
                      ) : (
                        part.text
                      ),
                    )}
                  </span>
                </Link>
              </Entry>
            ))}
          </EntryList>
        </>
      )}
    </div>
  );
}
