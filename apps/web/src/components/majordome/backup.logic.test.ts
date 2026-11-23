import type { MajordomeBackupStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { backupHeadline, backupAttention, folderFormProblem } from "./backup.logic";

const base: MajordomeBackupStatus = {
  isVault: true,
  lastSavedAt: null,
  saveError: null,
  paused: null,
  remote: null,
  folder: null,
  drive: null,
  hasPassphrase: false,
  googleDrive: { available: true, signedIn: false },
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

const peer = (overrides: Partial<NonNullable<MajordomeBackupStatus["peer"]>>) => ({
  label: "majordome",
  environmentId: "env-server",
  linkedHere: true,
  inStep: true,
  lastInStepAt: "2026-11-17T08:00:00Z",
  problem: null,
  needsReconnect: false,
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

  it("says notes on two machines are on two machines, without calling that a backup", () => {
    const onTwo = { ...base, peer: peer({}) };
    expect(backupHeadline(onTwo)).toMatchObject({
      tone: "neutral",
      title: "On two of your computers",
    });
    expect(backupHeadline(onTwo).detail).toContain("also on majordome");
    expect(backupAttention(onTwo)).toBeNull();
    // Still catching up is not a problem, and a real backup keeps its own line.
    expect(backupAttention({ ...base, peer: peer({ inStep: false }) })).toBeNull();
    expect(backupHeadline({ ...onTwo, remote: remote({}) }).title).toBe("Backed up to GitHub ✓");

    const failing = {
      ...base,
      remote: remote({}),
      peer: peer({
        inStep: false,
        needsReconnect: true,
        problem: "majordome no longer accepts this computer.",
      }),
    };
    expect(backupHeadline(failing)).toEqual({
      tone: "warning",
      title: "Not in step with majordome",
      detail: "majordome no longer accepts this computer.",
    });
    expect(backupAttention(failing)).toBe("Notes aren't in step");
  });

  it("flags a pause, a failed save or a failing backup, but not a backup never set up", () => {
    expect(backupAttention(base)).toBeNull();
    expect(backupAttention({ ...base, remote: remote({ syncing: false }) })).toBeNull();
    expect(
      backupAttention({
        ...base,
        remote: remote({}),
        otherVersions: [{ path: "memory.md", copy: "memory (version from Mac, 2026-11-17).md" }],
      }),
    ).toBe("Two versions of a note");
    expect(backupAttention({ ...base, remote: remote({}) })).toBeNull();
    expect(
      backupAttention({
        ...base,
        paused: { reason: "secret", files: ["keys.md"], since: "2026-11-15T00:00:00Z" },
      }),
    ).toBe("Backup paused");
    expect(backupAttention({ ...base, saveError: "Disk full." })).toBe("Saving isn't working");
    expect(
      backupAttention({
        ...base,
        remote: remote({ backedUp: false, lastError: "Couldn't reach GitHub." }),
      }),
    ).toBe("Backup isn't working");
  });

  it("names Google Drive, and says plainly when a Drive copy failed", () => {
    const drive = {
      lastBackupAt: "2026-11-15T02:00:00Z",
      lastFile: "x.age",
      lastError: null,
      problem: null,
    };
    expect(backupHeadline({ ...base, drive }).title).toBe("Backed up to Google Drive ✓");
    expect(
      backupHeadline({
        ...base,
        drive: { ...drive, lastError: "Your Google Drive is full.", problem: "quota-full" },
      }),
    ).toMatchObject({ tone: "warning", title: "Couldn't back up to Google Drive" });
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
    expect(folderFormProblem({ ...ok, path: null, confirmation: ok.passphrase })).toBeNull();
  });
});
