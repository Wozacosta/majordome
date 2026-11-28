import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { findSetupChats, isSetupChat, phoneSettingsPage } from "./setupChat.logic";

const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const notes = ProjectId.make("notes");
const code = ProjectId.make("code");
const thread = ThreadId.make("set-up");

describe("findSetupChats", () => {
  it("finds the notes folder's chat, started or not", () => {
    expect(
      findSetupChats(
        [
          { environmentId: mac, id: code },
          { environmentId: mac, id: notes },
          { environmentId: server, id: notes },
        ],
        [
          { isVault: false },
          { isVault: true, setupThreadId: thread },
          { isVault: true, setupThreadId: null },
        ],
      ),
    ).toEqual([
      { environmentId: mac, projectId: notes, threadId: thread },
      { environmentId: server, projectId: notes, threadId: null },
    ]);
  });

  it("leaves out a computer from before the Set-up chat, and one that has not answered", () => {
    expect(
      findSetupChats(
        [
          { environmentId: mac, id: notes },
          { environmentId: server, id: notes },
        ],
        [{ isVault: true }, null],
      ),
    ).toEqual([]);
  });
});

describe("isSetupChat", () => {
  const chats = [{ environmentId: mac, projectId: notes, threadId: thread }];

  it("matches the chat on its own computer only", () => {
    expect(isSetupChat(chats, "mac", "set-up")).toBe(true);
    expect(isSetupChat(chats, "server", "set-up")).toBe(false);
    expect(isSetupChat(chats, "mac", "another")).toBe(false);
  });
});

describe("phoneSettingsPage", () => {
  it("opens the phone's own page for what the owner alone can do", () => {
    expect(phoneSettingsPage("/settings/providers")).toBe("SettingsProviderAccounts");
    expect(phoneSettingsPage("/settings/voice")).toBe("SettingsVoice");
  });

  it("has no page for a screen only the computer's app has", () => {
    expect(phoneSettingsPage("/settings/backup")).toBeNull();
    expect(phoneSettingsPage("/routines")).toBeNull();
  });
});
