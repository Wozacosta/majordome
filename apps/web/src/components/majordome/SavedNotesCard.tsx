import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CircleCheckIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { savedNotes } from "./savedNotes.logic";
import { notesLink } from "./notes.logic";

/** What a reply changed in the notes, by note title, in place of the coding app's file diff card. */
export function SavedNotesCard(props: {
  readonly files: ReadonlyArray<string>;
  readonly projectId: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly onSeeChanges: () => void;
}) {
  const nowMinute = useNowMinute();
  const notes = savedNotes(props.files, Date.parse(`${nowMinute}:00.000Z`));
  if (notes.shown.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg bg-secondary px-3 py-2.5 dark:bg-input/20" data-saved-notes="">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CircleCheckIcon className="size-4 shrink-0 text-success-foreground" aria-hidden />
          Saved to your notes
        </p>
        <Button type="button" size="xs" variant="ghost-muted" onClick={props.onSeeChanges}>
          See what changed
        </Button>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1 ps-6 text-sm">
        {notes.shown.map((note) => (
          <li key={note.path} className="flex min-w-0 items-baseline gap-2">
            {note.openable ? (
              <Link
                {...notesLink({
                  projectId: props.projectId,
                  environmentId: props.environmentId,
                  path: note.path,
                })}
                className="min-w-0 truncate rounded-sm text-foreground underline decoration-border underline-offset-4 outline-none hover:decoration-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {note.title}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-foreground">{note.title}</span>
            )}
            {note.folder !== null ? (
              <span className="shrink-0 text-xs text-muted-foreground">in {note.folder}</span>
            ) : null}
          </li>
        ))}
        {notes.more > 0 ? (
          <li className="text-xs text-muted-foreground">and {notes.more} more</li>
        ) : null}
      </ul>
    </div>
  );
}
