import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import { serviceBrand, servicesUsedByRun } from "./servicesUsed.logic";

const run = RunId.make("run-1");

function step(id: string, entry: Partial<WorkLogEntry>): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: "2026-11-24T10:00:00.000Z",
    entry: {
      id,
      createdAt: "2026-11-24T10:00:00.000Z",
      runId: run,
      label: id,
      tone: "tool",
      toolLifecycleStatus: "completed",
      ...entry,
    },
  };
}

const gmail = { key: "mcp:gmail", name: "Gmail", kind: "integration" } as const;
const calendar = {
  key: "mcp:google_calendar",
  name: "Google Calendar",
  kind: "integration",
} as const;

describe("servicesUsedByRun", () => {
  it("names each service an answer reached once, and leaves out the ones that refused", () => {
    const services = servicesUsedByRun([
      step("search", { toolSource: gmail }),
      step("read", { toolSource: gmail }),
      step("events", { toolSource: calendar, toolLifecycleStatus: "failed" }),
      step("browser", { toolSource: { key: "browser", name: "Browser", kind: "browser" } }),
      step("shell", { command: "ls" }),
    ]);
    expect(services.get(run)).toEqual([gmail]);
  });

  it("leaves out the app's own tools", () => {
    const services = servicesUsedByRun([
      step("keys", { toolSource: { key: "mcp:t3-code", name: "T3 Code", kind: "integration" } }),
      step("direct", {
        toolSource: { key: "mcp:t3_code_direct", name: "t3 code direct", kind: "integration" },
      }),
    ]);
    expect(services.get(run)).toBeUndefined();
  });
});

describe("serviceBrand", () => {
  it("knows a connector however its name is spelled", () => {
    expect(serviceBrand("Gmail")).toBe("gmail");
    expect(serviceBrand("Google Calendar")).toBe("google-calendar");
    expect(serviceBrand("google_drive")).toBe("google-drive");
    expect(serviceBrand("laterlist")).toBeNull();
  });
});
