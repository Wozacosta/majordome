import { EnvironmentId, MajordomeNoteError, ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { fakeTimers, render } from "../../../test/render";
import { NOTE_SAVE_DELAY_MS } from "./noteEditing.logic";
import { NotePreview } from "./NotePreview";
import { notesLink } from "./notes.logic";

const state = vi.hoisted(() => ({
  canSave: true,
  refused: null as "changed" | "failed" | null,
  saves: [] as Array<unknown>,
}));
const setup = (next: { readonly canSave?: boolean; readonly refused?: "changed" | "failed" }) => {
  state.canSave = next.canSave ?? true;
  state.refused = next.refused ?? null;
  state.saves = [];
};

vi.mock("../files/projectFilesQueryState", () => ({
  useProjectFileQuery: () => ({
    data: { relativePath: "trips/paris.md", contents: "Paris", byteLength: 5, truncated: false },
    error: null,
    readError: null,
    refresh: () => {},
  }),
}));
vi.mock("../files/FileMarkdownPreview", () => ({
  FileMarkdownPreview: ({ text }: { readonly text: string }) => <article>{text}</article>,
}));
vi.mock("../../state/majordome", () => ({
  majordomeEnvironment: { saveNote: { permissionAtom: () => "permission" } },
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: unknown) => (atom === "permission" ? state.canSave : []),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async (request: unknown) => {
    state.saves.push(request);
    return state.refused === null
      ? { _tag: "Success", value: undefined }
      : {
          _tag: "Failure",
          cause: Cause.fail(
            state.refused === "changed"
              ? new MajordomeNoteError({ message: "Changed.", reason: "changed" })
              : new MajordomeNoteError({ message: "Could not save that note." }),
          ),
        };
  },
}));

const vault = {
  environmentId: EnvironmentId.make("env"),
  projectId: ProjectId.make("project"),
  title: "Notes",
  workspaceRoot: "/vault",
};
const note = (
  <NotePreview
    vault={vault}
    path="trips/paris.md"
    revision={null}
    showTitle
    editable
    noteLink={(path) => notesLink({ projectId: vault.projectId, path })}
  />
);
const saveOf = (content: string) => ({
  environmentId: "env",
  input: { projectId: "project", path: "trips/paris.md", content, base: "Paris" },
});

it("saves a note typed in place once the typing pauses", async () => {
  setup({});
  await using screen = await render(note);
  // A note opens as it reads; writing starts when asked for.
  await screen.getByRole("button", { name: "Edit" }).click();
  const editor = screen.getByRole("textbox", { name: "This note" });
  await expect.element(editor).toHaveTextContent("Paris");
  {
    using _timers = fakeTimers();
    await editor.click();
    await userEvent.keyboard("{End}, Lyon");
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS - 1);
    expect(state.saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
  }

  expect(state.saves).toEqual([saveOf("Paris, Lyon")]);
  await expect.element(screen.getByText("Saved to your notes")).toBeVisible();
});

it("offers to keep either version when the note was changed somewhere else", async () => {
  setup({ refused: "changed" });
  await using screen = await render(note);
  // A note opens as it reads; writing starts when asked for.
  await screen.getByRole("button", { name: "Edit" }).click();
  const editor = screen.getByRole("textbox", { name: "This note" });
  await editor.click();
  await userEvent.keyboard("{End}!");
  // Leaving the note saves at once, without the pause.
  await userEvent.tab();

  const alert = screen.getByRole("alert");
  await expect
    .element(alert.getByText("This note was changed somewhere else while you were writing."))
    .toBeVisible();
  await expect.element(alert.getByRole("button", { name: "Use the other version" })).toBeVisible();
  expect(alert.getByRole("button", { name: "Try again" }).query()).toBeNull();

  state.refused = null;
  await alert.getByRole("button", { name: "Keep mine (replaces the other change)" }).click();
  await expect.element(screen.getByText("Saved to your notes")).toBeVisible();
  expect(state.saves).toEqual([saveOf("Paris!"), saveOf("Paris!")]);
});

it("keeps an unsaved note open on Done, and opens it on the same writing again", async () => {
  setup({ refused: "failed" });
  {
    await using screen = await render(note);
    await screen.getByRole("button", { name: "Edit" }).click();
    const editor = screen.getByRole("textbox", { name: "This note" });
    await editor.click();
    await userEvent.keyboard("{End}?");
    await screen.getByRole("button", { name: "Done" }).click();

    await expect
      .element(screen.getByRole("alert").getByText("Not saved. Could not save that note."))
      .toBeVisible();
    await expect.element(editor).toHaveTextContent("Paris?");
  }

  await using screen = await render(note);
  await expect
    .element(screen.getByRole("textbox", { name: "This note" }))
    .toHaveTextContent("Paris?");
  state.refused = null;
  await screen.getByRole("alert").getByRole("button", { name: "Try again" }).click();
  await expect.element(screen.getByText("Saved to your notes")).toBeVisible();
  expect(state.saves.at(-1)).toEqual(saveOf("Paris?"));
});

it("shows the note as it reads to a device that may not save it", async () => {
  setup({ canSave: false });
  await using screen = await render(note);

  await expect.element(screen.getByRole("article")).toHaveTextContent("Paris");
  expect(screen.container.querySelector("[role='textbox']")).toBeNull();
});
