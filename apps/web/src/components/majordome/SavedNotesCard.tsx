import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, CircleCheckIcon, GraduationCapIcon } from "lucide-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { savedNotes } from "./savedNotes.logic";
import { skillTitle } from "./skills.logic";
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
  if (notes.shown.length === 0 && notes.skills.length === 0) return null;
  if (notes.shown.length === 0) return <WroteSkills names={notes.skills} />;
  const count = notes.shown.length + notes.more;
  return (
    <div className="mt-4 rounded-lg bg-secondary px-3 py-2.5 dark:bg-input/20" data-saved-notes="">
      <Collapsible>
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger className="group flex min-w-0 items-center gap-2 rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <CircleCheckIcon className="size-4 shrink-0 text-success-foreground" aria-hidden />
            <span className="shrink-0 font-medium text-foreground">Saved to your notes</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {count === 1 ? notes.shown[0]?.title : `${count} notes`}
            </span>
            <ChevronRightIcon
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
          </CollapsibleTrigger>
          <Button type="button" size="xs" variant="ghost-muted" onClick={props.onSeeChanges}>
            See what changed
          </Button>
        </div>
        <CollapsiblePanel>
          <ul className="flex flex-col gap-1 ps-6 pt-1.5 text-sm">
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
        </CollapsiblePanel>
      </Collapsible>
      {notes.skills.length > 0 ? <WroteSkills names={notes.skills} nested /> : null}
    </div>
  );
}

/** The skills a reply wrote for itself; none is used until the owner keeps it on the Skills page. */
function WroteSkills(props: { readonly names: ReadonlyArray<string>; readonly nested?: boolean }) {
  return (
    <div
      className={
        props.nested
          ? "mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5"
          : "mt-4 flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2.5 dark:bg-input/20"
      }
      data-wrote-skills=""
    >
      <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        <GraduationCapIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="font-medium">
            {props.names.length === 1 ? "Wrote a skill: " : "Wrote skills: "}
          </span>
          {props.names.map(skillTitle).join(", ")}
        </span>
      </p>
      <Button size="xs" variant="ghost-muted" render={<Link to="/settings/skills" />}>
        Review
      </Button>
    </div>
  );
}
