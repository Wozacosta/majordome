import type { MajordomeBackupStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { backupHeadline, folderFormProblem, restoreCommands } from "./backup.logic";

const base: MajordomeBackupStatus = {
  isVault: true,
  lastSavedAt: null,
  saveError: null,
  paused: null,
  remote: null,
  folder: null,
  github: { available: true, signedIn: false },
  secretScan: true,
};

const remote = (overrides: Partial<NonNullable<MajordomeBackupStatus["remote"]>>) => ({
  name: "origin",
  host: "github.com",
  isGitHub: true,
  webUrl: "https://github.com/someone/brain",
  syncing: true,
  backedUp: true,
  lastSyncedAt: null,
  lastError: null,
  ...overrides,
});

describe("backupHeadline", () => {
  it("names where a vault is backed up, in plain words", () => {
    expect(backupHeadline({ ...base, remote: remote({}) }).title).toBe("Backed up to GitHub ✓");
    expect(
      backupHeadline({ ...base, remote: remote({ host: "vps.example.com", isGitHub: false }) })
        .title,
    ).toBe("Backed up to vps.example.com ✓");
    expect(backupHeadline({ ...base, remote: remote({ host: null, isGitHub: false }) }).title).toBe(
      "Backed up to another folder on this computer ✓",
    );
  });

  it("puts a pause ahead of everything else", () => {
    const headline = backupHeadline({
      ...base,
      remote: remote({}),
      paused: { reason: "secret", files: ["keys.md"], since: "2026-11-15T00:00:00Z" },
    });
    expect(headline).toMatchObject({
      tone: "warning",
      title: "A possible secret was found in your notes; saving is paused",
    });
    expect(
      backupHeadline({
        ...base,
        paused: { reason: "conflict", files: ["memory.md"], since: "2026-11-15T00:00:00Z" },
      }).title,
    ).toBe("Your notes changed in two places; syncing is paused");
  });

  it("says when nothing backs the vault up, including a sync that was turned off", () => {
    expect(backupHeadline(base)).toMatchObject({ tone: "warning", title: "Not backed up yet" });
    expect(backupHeadline({ ...base, remote: remote({ syncing: false }) }).title).toBe(
      "Not backed up yet",
    );
  });

  it("reports a failed send, and a folder backup that worked", () => {
    expect(
      backupHeadline({
        ...base,
        remote: remote({ backedUp: false, lastError: "Could not resolve host: github.com" }),
      }),
    ).toMatchObject({ tone: "warning", title: "Couldn't back up to GitHub" });
    expect(
      backupHeadline({
        ...base,
        folder: {
          path: "/Volumes/USB",
          keep: 14,
          lastBackupAt: "2026-11-15T02:00:00Z",
          lastFile: "majordome-brain-2026-11-15.age",
          lastError: null,
        },
      }).title,
    ).toBe("Backed up to your folder every night ✓");
  });
});

describe("folderFormProblem", () => {
  it("wants a folder and a long enough passphrase typed twice", () => {
    const ok = { path: "/Volumes/USB", passphrase: "four words for notes", confirmation: "" };
    expect(folderFormProblem({ ...ok, path: " " })).toBe("Choose a folder.");
    expect(folderFormProblem({ ...ok, passphrase: "short", confirmation: "short" })).toContain(
      "at least 8",
    );
    expect(folderFormProblem(ok)).toBe("The two passphrases don't match.");
    expect(folderFormProblem({ ...ok, confirmation: ok.passphrase })).toBeNull();
  });
});

it("shows restore commands with the vault's own file name", () => {
  expect(restoreCommands("My Brain")[0]).toBe(
    "age -d -o brain.bundle majordome-my-brain-YYYY-MM-DD.age",
  );
});
