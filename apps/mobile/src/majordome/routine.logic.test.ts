import { expect, it } from "vite-plus/test";

import { gatherRoutineChats, routineChats } from "./routine.logic";

it("knows a routine's chats: the one it keeps and the earlier runs that carry its name", () => {
  const found = routineChats(
    [
      { title: "Tidy my memory", threadId: "kept", schedule: { type: "cron" } },
      { title: "Call mum", threadId: "once", schedule: { type: "once" } },
    ],
    [
      { id: "kept", title: "Renamed since", createdBy: "agent" },
      { id: "old-run", title: "Tidy my memory", createdBy: "agent" },
      // The owner's own chat that happens to share the name, and a reminder's chat.
      { id: "mine", title: "Tidy my memory", createdBy: "user" },
      { id: "once", title: "Call mum", createdBy: "agent" },
    ],
  );
  expect([...found]).toEqual([
    ["kept", "Tidy my memory"],
    ["old-run", "Tidy my memory"],
  ]);
});

it("gathers each routine's chats under its latest run and leaves out hidden routines", () => {
  const routineOf = new Map([
    ["tidy-3", "Tidy"],
    ["tidy-2", "Tidy"],
    ["tidy-1", "Tidy"],
    ["day-1", "Start my day"],
  ]);
  const idOf = (item: string) => (item === "label" ? null : item);
  const gathered = gatherRoutineChats(
    ["tidy-3", "chat", "day-1", "label", "tidy-2", "tidy-1"],
    idOf,
    routineOf,
    new Set(["Start my day"]),
  );
  expect(gathered.items).toEqual(["tidy-3", "chat", "label", "tidy-2", "tidy-1"]);
  expect([...gathered.byThread]).toEqual([
    ["tidy-3", { id: "routine:Tidy", title: "Tidy", sideThreadIds: ["tidy-2", "tidy-1"] }],
  ]);
});
