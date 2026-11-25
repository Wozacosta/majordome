import { type MajordomePrivateDocument, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isNoteFileName,
  moreFilesLine,
  topicFileDate,
  topicFileRows,
} from "./majordomeTopicFiles.ts";

const brain = ProjectId.make("brain");

const privateDocument = (
  id: string,
  fileName: string,
  addedAt: string,
  where?: { readonly projectId: ProjectId; readonly topicId: string },
): MajordomePrivateDocument => ({
  id: id.padEnd(32, "0"),
  name: fileName,
  description: "",
  fileName,
  mediaType: "application/pdf",
  sizeBytes: 2_048,
  addedAt,
  ...(where === undefined ? {} : { topic: where }),
});

describe("majordomeTopicFiles", () => {
  it("lists the topic's files with its own private documents, newest first", () => {
    const where = { projectId: brain, topicId: "finances" };
    const rows = topicFileRows(
      [
        {
          path: "projects/finances/bill.pdf",
          name: "bill.pdf",
          sizeBytes: 10,
          modifiedAt: "2026-11-10T10:00:00.000Z",
        },
        {
          path: "projects/finances/2026/lease.png",
          name: "lease.png",
          sizeBytes: 20,
          modifiedAt: "2026-11-18T10:00:00.000Z",
        },
      ],
      [
        privateDocument("a", "passport.pdf", "2026-11-12T10:00:00.000Z", where),
        privateDocument("b", "other-topic.pdf", "2026-11-19T10:00:00.000Z", {
          ...where,
          topicId: "travel",
        }),
        privateDocument("c", "other-brain.pdf", "2026-11-19T10:00:00.000Z", {
          ...where,
          projectId: ProjectId.make("work"),
        }),
        privateDocument("d", "no-topic.pdf", "2026-11-19T10:00:00.000Z"),
      ],
      where,
    );
    expect(rows.map((row) => [row.kind, row.name, row.at])).toEqual([
      ["file", "lease.png", "2026-11-18T10:00:00.000Z"],
      ["private", "passport.pdf", "2026-11-12T10:00:00.000Z"],
      ["file", "bill.pdf", "2026-11-10T10:00:00.000Z"],
    ]);
  });

  it("dates a file briefly", () => {
    const now = Date.parse("2026-11-20T10:00:00.000Z");
    expect(topicFileDate("2026-11-03T10:00:00.000Z", now, "en-GB", "UTC")).toBe("3 Nov");
    expect(topicFileDate("2025-12-31T23:30:00.000Z", now, "en-GB", "UTC")).toBe("31 Dec 2025");
    expect(topicFileDate("not a date", now, "en-GB", "UTC")).toBe("");
  });

  it("says how many files the capped list leaves out", () => {
    expect(moreFilesLine(100, 100)).toBeNull();
    expect(moreFilesLine(101, 100)).toBe("1 more file in this topic's folder");
    expect(moreFilesLine(140, 100)).toBe("40 more files in this topic's folder");
  });
});

it("knows a Markdown file is a note, whatever its case", () => {
  expect(isNoteFileName("s02e05-agent-reliability.md")).toBe(true);
  expect(isNoteFileName("Notes.MARKDOWN ")).toBe(true);
  expect(isNoteFileName("bill.pdf")).toBe(false);
  expect(isNoteFileName("readme.md.pdf")).toBe(false);
});
