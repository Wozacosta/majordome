import {
  EnvironmentId,
  MAJORDOME_TOPIC_FILE_MAX_BYTES,
  type MajordomePrivateDocument,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  moreFilesLine,
  privateDocumentNameFor,
  topicFileDate,
  topicFilePreviewable,
  topicFileProblem,
  topicFileRows,
  topicOfThread,
} from "./topicFiles.logic";

const mac = EnvironmentId.make("mac");
const server = EnvironmentId.make("server");
const brain = ProjectId.make("brain");

const topic = (id: string, threadId: string | null, folderExists = true) => ({
  id,
  title: id,
  folder: `projects/${id}`,
  threadId: threadId === null ? null : ThreadId.make(threadId),
  threadEnvironmentId: mac,
  folderExists,
  keyNote: null,
});

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

describe("topicFiles.logic", () => {
  it("finds a thread's topic on the thread's own server, only while its folder exists", () => {
    const copies = [
      {
        environmentId: mac,
        projectId: brain,
        topics: [topic("finances", "t-1"), topic("moved", "t-2", false), topic("unopened", null)],
      },
      {
        environmentId: server,
        projectId: ProjectId.make("brain-copy"),
        topics: [topic("x", "t-1")],
      },
    ];
    expect(topicOfThread(copies, mac, ThreadId.make("t-1"))).toMatchObject({
      projectId: brain,
      topic: { id: "finances" },
    });
    expect(topicOfThread(copies, server, ThreadId.make("t-1"))?.topic.id).toBe("x");
    expect(topicOfThread(copies, mac, ThreadId.make("t-2"))).toBeNull();
    expect(topicOfThread(copies, mac, ThreadId.make("plain-chat"))).toBeNull();
  });

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

  it("shows in a tab only what a browser can show, and dates a file briefly", () => {
    expect(["bill.PDF", "scan.jpeg", "photo.webp", "notes.txt"].every(topicFilePreviewable)).toBe(
      true,
    );
    expect(["lease.docx", "page.html", "logo.svg", "pdf"].some(topicFilePreviewable)).toBe(false);

    const now = Date.parse("2026-11-20T10:00:00.000Z");
    expect(topicFileDate("2026-11-03T10:00:00.000Z", now, "en-GB", "UTC")).toBe("3 Nov");
    expect(topicFileDate("2025-12-31T23:30:00.000Z", now, "en-GB", "UTC")).toBe("31 Dec 2025");
    expect(topicFileDate("not a date", now, "en-GB", "UTC")).toBe("");
  });

  it("refuses an empty file and one over 25 MB before anything is uploaded", () => {
    expect(topicFileProblem({ size: 0 })).toBe("That file is empty.");
    expect(topicFileProblem({ size: MAJORDOME_TOPIC_FILE_MAX_BYTES })).toBeNull();
    expect(topicFileProblem({ size: MAJORDOME_TOPIC_FILE_MAX_BYTES + 1 })).toBe(
      "That file is too large. Files can be up to 25 MB.",
    );
  });

  it("names a file kept private so no two private documents share a name", () => {
    expect(privateDocumentNameFor("passport_scan.pdf", [])).toBe("passport scan");
    expect(
      privateDocumentNameFor("passport_scan.pdf", [
        { name: "Passport Scan" },
        { name: "passport scan 2" },
      ]),
    ).toBe("passport scan 3");
    expect(
      privateDocumentNameFor(`${"a".repeat(200)}.pdf`, [{ name: "a".repeat(116) }]),
    ).toHaveLength(118);
  });

  it("says how many files the capped list leaves out", () => {
    expect(moreFilesLine(100, 100)).toBeNull();
    expect(moreFilesLine(101, 100)).toBe("1 more file in this topic's folder");
    expect(moreFilesLine(140, 100)).toBe("40 more files in this topic's folder");
  });
});
