import { EnvironmentId, type MajordomeLibraryFile, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  libraryBadge,
  libraryItems,
  libraryType,
  libraryView,
  libraryWhere,
  topicPlace,
} from "./library.logic";

const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const projectId = ProjectId.make("vault");

const notes = (path: string, at: string): MajordomeLibraryFile => ({
  _tag: "notes-file",
  path,
  name: path.split("/").at(-1) ?? path,
  sizeBytes: 10,
  at,
});
const chat = (
  name: string,
  threadId: string,
  at: string,
  mimeType = "application/octet-stream",
): MajordomeLibraryFile => ({
  _tag: "chat-file",
  attachmentId: `${threadId}-${name.replaceAll(/[^a-z]/g, "")}`,
  name,
  mimeType,
  sizeBytes: 10,
  at,
  threadId: ThreadId.make(threadId),
  threadTitle: `Chat ${threadId}`,
});

const topics = [
  {
    id: "money",
    title: "Money",
    folder: "admin/money",
    threadId: ThreadId.make("t-money"),
    threadEnvironmentId: mac,
    sideChats: [{ environmentId: server, threadId: ThreadId.make("t-money-side") }],
  },
  {
    id: "taxes",
    title: "Taxes",
    folder: "admin/money/taxes",
    threadId: null,
    threadEnvironmentId: mac,
  },
  { id: "trips", title: "Trips", folder: "trips", threadId: null, threadEnvironmentId: mac },
];

const items = libraryItems(
  [
    {
      environmentId: mac,
      projectId,
      files: [
        notes("admin/money/bill.pdf", "2026-11-01T00:00:00.000Z"),
        notes("admin/money/taxes/return.xlsx", "2026-11-02T00:00:00.000Z"),
        notes("inbox/Résumé.docx", "2026-11-03T00:00:00.000Z"),
        notes("photo.heic", "2026-11-04T00:00:00.000Z"),
        chat("receipt.png", "t-money", "2026-11-05T00:00:00.000Z", "image/png"),
        // The same thread id on another server is another chat.
        chat("stray.csv", "t-money-side", "2026-11-06T00:00:00.000Z"),
      ],
    },
    {
      environmentId: server,
      projectId,
      files: [
        chat("Pasted image", "t-money-side", "2026-11-07T00:00:00.000Z", "image/png"),
        chat("voice.m4a", "t-loose", "2026-11-08T00:00:00.000Z"),
      ],
    },
  ],
  topics,
);

const named = (list: ReadonlyArray<{ readonly name: string }>) => list.map((item) => item.name);

describe("libraryType", () => {
  it.each([
    ["scan.PNG", undefined, "image"],
    ["lease.pdf", undefined, "document"],
    ["prices.xlsx", undefined, "spreadsheet"],
    ["agent-keys.ts", undefined, "code"],
    ["interview.m4a", undefined, "media"],
    ["Pasted image", "image/png", "image"],
    ["clip", "video/mp4", "media"],
    ["archive.zip", "application/zip", "other"],
    [".env", undefined, "other"],
  ] as const)("%s is %s", (name, mimeType, type) => {
    expect(libraryType(name, mimeType)).toBe(type);
  });
});

describe("libraryBadge", () => {
  it.each([
    ["lease.pdf", "PDF"],
    ["prices.XLSX", "XLSX"],
    ["Pasted image", "FILE"],
    ["notes.markdown-old", "FILE"],
  ])("%s shows %s", (name, badge) => {
    expect(libraryBadge(name)).toBe(badge);
  });
});

describe("libraryItems", () => {
  it("lists every server's files newest first, each under its topic", () => {
    expect(items.map((item) => [item.name, item.topicId, item.environmentId])).toEqual([
      ["voice.m4a", null, server],
      ["Pasted image", "money", server],
      ["stray.csv", null, mac],
      ["receipt.png", "money", mac],
      ["photo.heic", null, mac],
      ["Résumé.docx", null, mac],
      ["return.xlsx", "taxes", mac],
      ["bill.pdf", "money", mac],
    ]);
  });

  it("shows as itself only a picture a browser can draw", () => {
    expect(named(items.filter((item) => item.thumbnail))).toEqual(["Pasted image", "receipt.png"]);
  });
});

describe("libraryView", () => {
  const view = (choice: Partial<Parameters<typeof libraryView>[2]>) =>
    libraryView(items, topics, { query: "", place: "all", type: "all", ...choice });

  it("counts each place and each type that holds something", () => {
    const all = view({});
    expect(all.places).toEqual([
      { place: "all", count: 8 },
      { place: "topic:money", count: 3 },
      { place: "topic:taxes", count: 1 },
      { place: "none", count: 4 },
    ]);
    expect(all.tabs).toEqual([
      { type: "all", count: 8 },
      { type: "image", count: 3 },
      { type: "document", count: 2 },
      { type: "spreadsheet", count: 2 },
      { type: "media", count: 1 },
    ]);
    expect(all.shown).toHaveLength(8);
  });

  it("narrows the tabs to the chosen topic and the list to the chosen type", () => {
    const money = view({ place: topicPlace("money"), type: "image" });
    expect(money.tabs).toEqual([
      { type: "all", count: 3 },
      { type: "image", count: 2 },
      { type: "document", count: 1 },
    ]);
    expect(named(money.shown)).toEqual(["Pasted image", "receipt.png"]);
    expect(named(view({ place: "none" }).shown)).toEqual([
      "voice.m4a",
      "stray.csv",
      "photo.heic",
      "Résumé.docx",
    ]);
  });

  it("finds a file by part of its name, whatever its accents and capitals", () => {
    const found = view({ query: " resume " });
    expect(named(found.shown)).toEqual(["Résumé.docx"]);
    // One place holds it, so there is nothing to choose between.
    expect(found.places).toEqual([{ place: "all", count: 1 }]);
  });

  it("falls back to everything when the choice holds nothing the search finds", () => {
    const found = view({ query: "bill", place: topicPlace("taxes"), type: "image" });
    expect(found.place).toBe("all");
    expect(found.type).toBe("all");
    expect(named(found.shown)).toEqual(["bill.pdf"]);
  });

  it("puts the files of a topic no longer listed with those of no topic", () => {
    const gone = libraryView(items, [topics[0]!], { query: "", place: "none", type: "all" });
    expect(gone.places).toEqual([
      { place: "all", count: 8 },
      { place: "topic:money", count: 3 },
      { place: "none", count: 5 },
    ]);
    expect(named(gone.shown)).toContain("return.xlsx");
  });
});

describe("libraryWhere", () => {
  it("names the topic, else the chat, else the folder", () => {
    const where = (name: string) =>
      libraryWhere(
        items.find((item) => item.name === name)!,
        topics,
      );
    expect(where("bill.pdf")).toBe("Money");
    expect(where("voice.m4a")).toBe("Chat t-loose");
    expect(where("Résumé.docx")).toBe("inbox");
    expect(where("photo.heic")).toBe("Notes");
  });
});
