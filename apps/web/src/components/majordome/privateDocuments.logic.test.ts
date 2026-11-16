import {
  MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES,
  type MajordomePrivateDocumentAccess,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  defaultDocumentName,
  describeAccess,
  fileProblem,
  nameProblem,
  privateDocumentFailureMessage,
} from "./privateDocuments.logic";

const access = (
  outcome: MajordomePrivateDocumentAccess["outcome"],
  asked = true,
): MajordomePrivateDocumentAccess => ({
  at: "2026-11-16T09:00:00.000Z",
  documentId: "0123456789abcdef0123456789abcdef",
  documentName: "Passport",
  outcome,
  ...(asked
    ? {
        requester: { threadId: ThreadId.make("thread-1"), title: "Visa form" },
        reason: " To copy the passport number. ",
      }
    : {}),
});

describe("privateDocuments.logic", () => {
  it("offers a readable name from the file's name", () => {
    expect(defaultDocumentName("passport_scan-2031.PDF")).toBe("passport scan 2031");
    expect(defaultDocumentName(".pdf")).toBe("Document");
    expect(defaultDocumentName("Tax return 2025")).toBe("Tax return 2025");
  });

  it("refuses an empty file and one over the cap before anything is uploaded", () => {
    expect(fileProblem({ size: 0 })).toBe("That file is empty.");
    expect(fileProblem({ size: MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES })).toBeNull();
    expect(fileProblem({ size: MAJORDOME_PRIVATE_DOCUMENT_MAX_BYTES + 1 })).toContain("25 MB");
  });

  it("keeps names unique whatever their letter case, since the assistant asks by name", () => {
    const documents = [{ name: "Passport" }];
    expect(nameProblem(" passport ", documents)).toBe(
      "Another private document already has that name.",
    );
    expect(nameProblem("   ", documents)).toBe("Give the document a name.");
    expect(nameProblem("Tax return", documents)).toBeNull();
  });

  it("says who asked, why, and whether the document was actually opened", () => {
    expect(describeAccess(access("allowed"))).toEqual({
      what: "“Visa form” opened it, after you allowed it.",
      reason: "To copy the passport number.",
      tone: "ok",
    });
    expect(describeAccess(access("denied")).what).toBe("“Visa form” asked for it and you said no.");
    expect(describeAccess(access("timed_out"))).toMatchObject({
      what: "“Visa form” asked for it. Nobody answered for 24 hours, so it stayed closed.",
      tone: "warning",
    });
    expect(describeAccess(access("cancelled")).what).toBe(
      "“Visa form” asked for it and stopped before an answer.",
    );
    expect(describeAccess(access("owner_viewed", false))).toEqual({
      what: "You downloaded it.",
      reason: null,
      tone: "ok",
    });
  });

  it("words a failure by its reason, even when it arrives as a plain tagged value", () => {
    expect(
      privateDocumentFailureMessage({
        _tag: "MajordomePrivateDocumentError",
        reason: "request_closed",
      }),
    ).toBe("This request is no longer waiting for an answer.");
    expect(privateDocumentFailureMessage(new Error("socket closed"))).toBe(
      "Something went wrong. Try again.",
    );
  });
});
