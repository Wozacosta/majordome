import {
  EnvironmentId,
  MAJORDOME_TOPIC_FILE_MAX_BYTES,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  privateDocumentNameFor,
  topicFilePreviewable,
  topicFileProblem,
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

  it("shows in a tab only what a browser can show", () => {
    expect(["bill.PDF", "scan.jpeg", "photo.webp", "notes.txt"].every(topicFilePreviewable)).toBe(
      true,
    );
    expect(["lease.docx", "page.html", "logo.svg", "pdf"].some(topicFilePreviewable)).toBe(false);
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
});
