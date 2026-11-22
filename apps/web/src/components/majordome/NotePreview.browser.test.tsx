import { EnvironmentId, ProjectId } from "@t3tools/contracts";
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
  refused: null as string | null,
  saves: [] as Array<unknown>,
}));
const setup = (next: { readonly canSave?: boolean; readonly refused?: string }) => {
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
      : { _tag: "Failure", cause: Cause.fail(new Error(state.refused)) };
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

it("offers the three ways out when a save is refused", async () => {
  setup({ refused: "This note changed while you were writing." });
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
    .element(alert.getByText("Not saved. This note changed while you were writing."))
    .toBeVisible();
  await expect.element(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect.element(alert.getByRole("button", { name: "Discard my changes" })).toBeVisible();

  state.refused = null;
  await alert.getByRole("button", { name: "Keep my version" }).click();
  await expect.element(screen.getByText("Saved to your notes")).toBeVisible();
  expect(state.saves).toEqual([saveOf("Paris!"), saveOf("Paris!")]);
});

it("shows the note as it reads to a device that may not save it", async () => {
  setup({ canSave: false });
  await using screen = await render(note);

  await expect.element(screen.getByRole("article")).toHaveTextContent("Paris");
  expect(screen.container.querySelector("[role='textbox']")).toBeNull();
});
