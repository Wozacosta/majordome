import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  majordomeMenuItems,
  type ThreadActionMenuState,
} from "./threadActionMenu.logic";

// These tests cover T3 Code's full menus; Majordome's cut is tested on its own below.
vi.mock("../env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../env")>()),
  isMajordome: false,
}));

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  it("disables only rename where no inline title editor exists", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canRename: false });
    expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(["rename"]);
  });

  it("leaves the developer items out of Majordome's menus", () => {
    const ids = (items: ReadonlyArray<{ id: string; children?: ReadonlyArray<{ id: string }> }>) =>
      items.flatMap((item) => [item.id, ...(item.children ?? []).map((child) => child.id)]);
    const thread = majordomeMenuItems(
      buildThreadActionMenuItems({
        ...baseState,
        branch: "main",
        projectFilter: { label: "Notes", isActive: false },
        canTurnIntoProject: true,
      }),
    );
    expect(ids(thread)).toEqual([
      "pin",
      "settle",
      "snooze",
      "snooze:hour",
      "snooze:custom",
      "rename",
      "regenerate-title",
      "mark-unread",
      "auto-settle",
      "auto-settle:enabled",
      "auto-settle:disabled",
      "copy",
      "copy-thread",
      "archive",
      "delete",
    ]);
    const draft = majordomeMenuItems(
      buildDraftActionMenuItems({ hasPath: true, hasBranch: true, hasProject: true }),
    );
    expect(ids(draft)).toEqual(["discard"]);
  });
});
