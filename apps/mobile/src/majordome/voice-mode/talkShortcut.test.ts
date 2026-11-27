import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const seen = vi.hoisted(() => ({
  platform: { OS: "ios" },
  items: [] as Array<ReadonlyArray<{ readonly id: string }>>,
  offered: [] as Array<boolean>,
  available: (_available: boolean) => {},
}));

vi.mock("react-native", () => ({ Platform: seen.platform }));
vi.mock("expo-quick-actions", () => ({
  setItems: async (items: ReadonlyArray<{ readonly id: string }>) => void seen.items.push(items),
}));
vi.mock("../../features/shortcuts/appShortcuts", () => ({
  talkShortcutAction: () => ({ id: "talk" }),
}));
vi.mock("../../features/shortcuts/appShortcutsRuntime", () => ({
  offerTalkShortcut: (offered: boolean) => void seen.offered.push(offered),
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    subscribe: (_atom: unknown, listener: (available: boolean) => void) => {
      seen.available = listener;
      listener(false);
      return () => {};
    },
  },
}));
vi.mock("./availability", () => ({ voiceModeAvailableAtom: {} }));

import { installTalkShortcut } from "./talkShortcut";

beforeEach(() => {
  seen.items.length = 0;
  seen.offered.length = 0;
});

describe("the Talk shortcut", () => {
  it("is the iPhone's whole list while the phone can talk", () => {
    seen.platform.OS = "ios";
    installTalkShortcut();
    seen.available(true);
    seen.available(false);
    expect(seen.items).toEqual([[], [{ id: "talk" }], []]);
    expect(seen.offered).toEqual([]);
  });

  it("joins Android's list without replacing its recent chats", () => {
    seen.platform.OS = "android";
    installTalkShortcut();
    seen.available(true);
    expect(seen.offered).toEqual([false, true]);
    expect(seen.items).toEqual([]);
  });
});
