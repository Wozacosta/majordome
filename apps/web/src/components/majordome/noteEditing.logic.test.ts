import { describe, expect, it, vi } from "vite-plus/test";

import {
  createNoteEditing,
  isNoteHeld,
  NOTE_EDITING_IDLE,
  NOTE_SAVE_DELAY_MS,
  type NoteEditingView,
  type NoteSaveOutcome,
  noteSaveStatus,
} from "./noteEditing.logic";

function fakeTimers(): Disposable {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}

function setUp(disk: string | null) {
  const state = { disk, view: NOTE_EDITING_IDLE as NoteEditingView };
  const saves: Array<{
    readonly content: string;
    readonly base: string | null;
    readonly settle: (outcome: NoteSaveOutcome) => void;
  }> = [];
  const editing = createNoteEditing({
    disk: () => state.disk,
    save: (content, base) =>
      new Promise((settle) => {
        saves.push({ content, base, settle });
      }),
    publish: (view) => {
      state.view = view;
    },
  });
  const pause = () => vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS);
  /** Settles the save in flight and lets what follows it run. */
  const settle = async (outcome: NoteSaveOutcome) => {
    saves.at(-1)!.settle(outcome);
    await vi.advanceTimersByTimeAsync(0);
  };
  const sent = () => saves.map(({ content, base }) => ({ content, base }));
  return { state, editing, pause, settle, sent };
}

describe("createNoteEditing", () => {
  it("saves once typing pauses, from the file the edit started on", async () => {
    using _timers = fakeTimers();
    const { state, editing, settle, sent } = setUp("Plan");

    editing.change("Plan");
    expect(state.view).toEqual(NOTE_EDITING_IDLE);

    editing.change("Plan A");
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS - 1);
    editing.change("Plan AB");
    await vi.advanceTimersByTimeAsync(NOTE_SAVE_DELAY_MS - 1);
    expect(sent()).toEqual([]);
    expect(noteSaveStatus(state.view)).toBe("Saving…");

    await vi.advanceTimersByTimeAsync(1);
    expect(sent()).toEqual([{ content: "Plan AB", base: "Plan" }]);

    await settle("saved");
    expect(noteSaveStatus(state.view)).toBe("Saved to your notes");
    // The file still reads as before the save until it is read again: the editor keeps its text.
    expect(isNoteHeld(state.view, "Plan")).toBe(true);
    expect(isNoteHeld(state.view, "Plan AB")).toBe(false);
  });

  it("saves what was typed during a save on top of that save", async () => {
    using _timers = fakeTimers();
    const { state, editing, pause, settle, sent } = setUp(null);

    editing.change("One");
    await pause();
    editing.change("One two");
    expect(await editing.flush()).toBe(false);
    await settle("saved");
    expect(sent()).toEqual([
      { content: "One", base: null },
      { content: "One two", base: "One" },
    ]);
    expect(noteSaveStatus(state.view)).toBe("Saving…");

    state.disk = "One";
    await settle("saved");
    // The second save is not read back yet, so the next edit still starts from what it saved.
    editing.change("One two three");
    await pause();
    expect(sent().at(-1)).toEqual({ content: "One two three", base: "One two" });
  });

  it("starts the next edit from the file once it changed underneath", async () => {
    using _timers = fakeTimers();
    const { state, editing, pause, settle, sent } = setUp("Mine");

    editing.change("Mine!");
    await pause();
    await settle("saved");
    state.disk = "Rewritten by the assistant";
    editing.change("Rewritten by the assistant, and me");
    await pause();

    expect(sent().at(-1)).toEqual({
      content: "Rewritten by the assistant, and me",
      base: "Rewritten by the assistant",
    });
  });

  it("holds a refused save until the owner chooses", async () => {
    using _timers = fakeTimers();
    const { state, editing, pause, settle, sent } = setUp("Old");

    editing.change("Mine");
    await pause();
    await settle({ problem: "This note changed while you were writing." });
    expect(state.view.problem).toBe("This note changed while you were writing.");
    expect(noteSaveStatus(state.view)).toBe("Not saved");

    editing.change("Mine, more");
    await pause();
    expect(await editing.flush()).toBe(false);
    expect(sent()).toHaveLength(1);

    editing.retry();
    expect(state.view.problem).toBeNull();
    expect(sent().at(-1)).toEqual({ content: "Mine, more", base: "Old" });
    await settle({ problem: "Still changed." });

    state.disk = "Theirs";
    editing.resolve(true);
    expect(sent().at(-1)).toEqual({ content: "Mine, more", base: "Theirs" });
    await settle("saved");
    expect(state.view).toEqual({ draft: null, settling: "Theirs", problem: null });
  });

  it("drops the draft when the owner discards it", async () => {
    using _timers = fakeTimers();
    const { state, editing, pause, settle, sent } = setUp("Old");

    editing.change("Mine");
    await pause();
    await settle({ problem: "Changed." });
    editing.resolve(false);

    expect(state.view).toEqual(NOTE_EDITING_IDLE);
    expect(isNoteHeld(state.view, "Theirs")).toBe(false);
    expect(await editing.flush()).toBe(true);
    expect(sent()).toHaveLength(1);
  });

  it("keeps the draft when a save is interrupted, and saves it on the next flush", async () => {
    using _timers = fakeTimers();
    const { state, editing, pause, settle, sent } = setUp("Old");

    editing.change("Mine");
    await pause();
    await settle("interrupted");
    expect(state.view).toEqual({ draft: "Mine", settling: undefined, problem: null });

    const flushed = editing.flush();
    await settle("saved");
    expect(await flushed).toBe(true);
    expect(sent().at(-1)).toEqual({ content: "Mine", base: "Old" });
  });
});
