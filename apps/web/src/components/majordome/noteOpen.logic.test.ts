import { PrimaryConnectionTarget, RelayConnectionTarget } from "@t3tools/client-runtime/connection";
import { type EditorId, EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveRemoteOpenState } from "../../remoteOpen";
import { mainNoteOpenTarget, noteOpenTargets, obsidianOpenUrl } from "./noteOpen.logic";

const environmentId = EnvironmentId.make("environment-1");

const primary = (httpBaseUrl: string) =>
  new PrimaryConnectionTarget({
    environmentId,
    label: "mac",
    httpBaseUrl,
    wsBaseUrl: httpBaseUrl.replace("http", "ws"),
  });

const EDITORS: ReadonlyArray<EditorId> = ["vscode", "zed", "file-manager"];
const EVERYTHING = [
  "editor:vscode",
  "editor:zed",
  "obsidian",
  "default-app",
  "reveal",
  "copy-path",
];

describe("noteOpenTargets", () => {
  it.each([
    {
      name: "the desktop app showing its own computer's notes",
      target: primary("http://127.0.0.1:3774"),
      isDesktopRenderer: true,
      expected: EVERYTHING,
    },
    {
      name: "a browser on the same computer as the notes",
      target: primary("http://localhost:3774"),
      isDesktopRenderer: false,
      expected: EVERYTHING,
    },
    {
      name: "the phone, whose notes are on another computer",
      target: primary("https://home.majord.link"),
      isDesktopRenderer: false,
      expected: [],
    },
    {
      name: "the desktop app showing another computer's copy",
      target: new RelayConnectionTarget({ environmentId, label: "server" }),
      isDesktopRenderer: true,
      expected: [],
    },
    {
      name: "a connection not allowed to start apps",
      target: primary("http://127.0.0.1:3774"),
      isDesktopRenderer: true,
      canOperate: false,
      expected: ["obsidian", "copy-path"],
    },
    {
      name: "a notes folder Obsidian already knows",
      target: primary("http://127.0.0.1:3774"),
      isDesktopRenderer: true,
      hasObsidianFolder: true,
      expected: ["obsidian", "editor:vscode", "editor:zed", "default-app", "reveal", "copy-path"],
    },
    {
      name: "a computer that cannot show a file in its folder",
      target: primary("http://127.0.0.1:3774"),
      isDesktopRenderer: true,
      canReveal: false,
      expected: ["editor:vscode", "editor:zed", "obsidian", "default-app", "copy-path"],
    },
  ])("offers what works for $name", (row) => {
    expect(
      noteOpenTargets({
        where: {
          isResolved: true,
          state: resolveRemoteOpenState({
            target: row.target,
            sshTarget: null,
            remoteOpenTargets: undefined,
            isDesktopRenderer: row.isDesktopRenderer,
            hostEnvironmentId: null,
          }),
        },
        canOperate: row.canOperate ?? true,
        availableEditors: EDITORS,
        canReveal: row.canReveal ?? true,
        hasObsidianFolder: row.hasObsidianFolder ?? false,
      }),
    ).toEqual(row.expected);
  });

  it("offers nothing until it is known which computer holds the notes", () => {
    expect(
      noteOpenTargets({
        where: { isResolved: false, state: { mode: "local-exec" } },
        canOperate: true,
        availableEditors: EDITORS,
        canReveal: true,
        hasObsidianFolder: true,
      }),
    ).toEqual([]);
  });
});

describe("mainNoteOpenTarget", () => {
  it("keeps the way used last time while it is offered, else takes the first", () => {
    const targets = ["editor:vscode", "obsidian", "copy-path"] as const;
    expect(mainNoteOpenTarget(targets, "obsidian")).toBe("obsidian");
    expect(mainNoteOpenTarget(targets, "editor:zed")).toBe("editor:vscode");
    expect(mainNoteOpenTarget(targets, null)).toBe("editor:vscode");
    expect(mainNoteOpenTarget([], "obsidian")).toBeNull();
  });
});

describe("obsidianOpenUrl", () => {
  it("carries the full path, encoded", () => {
    expect(obsidianOpenUrl("/Users/me/My Notes/research/crypto/log.md")).toBe(
      "obsidian://open?path=%2FUsers%2Fme%2FMy%20Notes%2Fresearch%2Fcrypto%2Flog.md",
    );
  });
});
