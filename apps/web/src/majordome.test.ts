import { assert, describe, it } from "vite-plus/test";

import type { KeybindingShortcut, ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { resolveThreadDetailsVisibility } from "./components/chat/threadDetailsItems";
import { SETTINGS_NAV_GROUPS } from "./components/settings/settingsSearch";
import { isMajordome } from "./env";
import { resolveShortcutCommand, type ShortcutEventLike } from "./keybindings";

const ctrl = (key: string): KeybindingShortcut => ({
  key,
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  modKey: false,
});

const press = (key: string): ShortcutEventLike => ({
  key,
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
});

describe("Majordome hides T3 Code's coding UI", () => {
  it("is on in this build", () => {
    assert.isTrue(isMajordome);
  });

  it("ignores coding shortcuts and keeps the rest", () => {
    const keybindings: ResolvedKeybindingsConfig = [
      { shortcut: ctrl("j"), command: "terminal.toggle" },
      { shortcut: ctrl("g"), command: "composer.branch" },
      { shortcut: ctrl("e"), command: "editor.openFavorite" },
      { shortcut: ctrl("b"), command: "sidebar.toggle" },
    ];
    const options = { platform: "Linux x86_64" };
    assert.isNull(resolveShortcutCommand(press("j"), keybindings, options));
    assert.isNull(resolveShortcutCommand(press("g"), keybindings, options));
    assert.isNull(resolveShortcutCommand(press("e"), keybindings, options));
    assert.equal(resolveShortcutCommand(press("b"), keybindings, options), "sidebar.toggle");
  });

  it("leaves coding pages out of the settings sidebar", () => {
    const paths = SETTINGS_NAV_GROUPS.flatMap((group) => group.paths);
    assert.notInclude(paths, "/settings/source-control");
    assert.notInclude(paths, "/settings/worktrees");
    assert.notInclude(paths, "/settings/devices");
    assert.include(paths, "/settings/projects");
  });

  it("hides git, editor and script rows in thread details by default", () => {
    const visibility = resolveThreadDetailsVisibility({
      threadDetailsItems: {},
      threadDetailsUsageEnabled: false,
    });
    for (const id of [
      "environment",
      "openIn",
      "scripts",
      "branch",
      "gitActions",
      "changes",
      "servers",
    ]) {
      assert.isFalse(visibility[id as keyof typeof visibility], id);
    }
  });
});
