import { useAtomValue } from "@effect/atom-react";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { MajordomeTodo, MajordomeTodoNote } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { type FormEvent, useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { majordomeEnvironment } from "../../state/majordome";
import { useAtomCommand } from "../../state/use-atom-command";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { notesLink } from "./notes.logic";
import { EntryList, Muted, PageHeader, ROW_ACTION_CLASS, Section, StatusLine } from "./paper";
import { todoDisplayText, todoKey, todosSummary, withoutTicked } from "./todos.logic";
import type { MajordomeVault } from "./topics.logic";
import { useMajordomeVaults } from "./useMajordomeVaults";

/** What is left to do: the unticked checkboxes of the notes, grouped by note. */
export function TodosPage() {
  const { activeVault, loading } = useMajordomeVaults();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border" />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-6 pb-12 sm:px-6">
            <PageHeader
              title="To-dos"
              intro={
                activeVault === null && !loading
                  ? "Open a notes folder to see its to-dos."
                  : "Every unticked box in your notes. Ticking one here ticks it in its note."
              }
            />
            {activeVault === null ? null : <VaultTodos key={activeVault.key} vault={activeVault} />}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** True when the command failed for a reason worth telling; the toast is already shown. */
function reportFailure(result: AtomCommandResult<unknown, unknown>, title: string): boolean {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
  return true;
}

function VaultTodos({ vault }: { readonly vault: MajordomeVault }) {
  const { environmentId, projectId } = vault;
  const result = useAtomValue(majordomeEnvironment.todos({ environmentId, input: { projectId } }));
  const canChange = useAtomValue(majordomeEnvironment.setTodoDone.permissionAtom(environmentId));
  const setTodoDone = useAtomCommand(majordomeEnvironment.setTodoDone, {
    label: "tick to-do",
    reportFailure: false,
  });
  // Ticked here; kept after the note is saved so a list read just before it never shows them again.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const tick = async (note: MajordomeTodoNote, todo: MajordomeTodo) => {
    const key = todoKey(note.path, todo);
    setTicked((current) => new Set(current).add(key));
    const outcome = await setTodoDone({
      environmentId,
      input: { projectId, path: note.path, line: todo.line, text: todo.text, done: true },
    });
    if (reportFailure(outcome, "Could not tick that to-do")) {
      setTicked((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const data = AsyncResult.getOrElse(result, () => null);
  const shown = data === null ? null : withoutTicked(data, ticked);
  return (
    <>
      {canChange ? <AddTodo vault={vault} /> : null}
      {shown === null ? (
        result._tag === "Failure" ? (
          <StatusLine tone="error" className="mt-6">
            Your to-dos could not be read. Open this page again to retry.
          </StatusLine>
        ) : null
      ) : shown.totalOpen === 0 ? (
        <Muted className="mt-8 border-t border-border py-3">
          Nothing to do. Write <code>- [ ]</code> in any note, or add one above.
        </Muted>
      ) : (
        <>
          <Muted className="mt-6">{todosSummary(shown.totalOpen, shown.totalNotes)}</Muted>
          {shown.notes.map((note) => (
            <Section
              key={note.path}
              className="mt-6"
              label={
                <Link
                  {...notesLink({ projectId, environmentId, path: note.path, from: "todos" })}
                  className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  {note.title}
                </Link>
              }
            >
              <EntryList aria-label={note.title}>
                {note.todos.map((todo) => (
                  <li key={todoKey(note.path, todo)} className="border-t border-border">
                    <label
                      className={cn(ROW_ACTION_CLASS, "flex min-h-10 items-start gap-2.5 py-2.5")}
                    >
                      <span className="flex h-5 shrink-0 items-center">
                        <Checkbox
                          checked={false}
                          disabled={!canChange}
                          onCheckedChange={() => void tick(note, todo)}
                        />
                      </span>
                      <span className="min-w-0 flex-1 text-sm wrap-break-word text-foreground">
                        {todoDisplayText(todo.text)}
                      </span>
                    </label>
                  </li>
                ))}
              </EntryList>
              {note.more > 0 ? (
                <Muted className="border-t border-border py-2.5 text-xs">
                  and {note.more} more in this note
                </Muted>
              ) : null}
            </Section>
          ))}
          {data !== null && data.totalNotes > data.notes.length ? (
            <Muted className="mt-8 text-xs">
              Showing the {data.notes.length} most recently changed notes.
            </Muted>
          ) : null}
        </>
      )}
    </>
  );
}

function AddTodo({ vault }: { readonly vault: MajordomeVault }) {
  const addTodo = useAtomCommand(majordomeEnvironment.addTodo, {
    label: "add to-do",
    reportFailure: false,
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || busy) return;
    setBusy(true);
    const outcome = await addTodo({
      environmentId: vault.environmentId,
      input: { projectId: vault.projectId, text },
    });
    setBusy(false);
    if (!reportFailure(outcome, "Could not add that to-do")) setDraft("");
  };

  return (
    <form className="mt-6" onSubmit={(event) => void submit(event)}>
      <Input
        nativeInput
        size="lg"
        aria-label="Add a to-do"
        placeholder="Add a to-do…"
        maxLength={500}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  );
}
