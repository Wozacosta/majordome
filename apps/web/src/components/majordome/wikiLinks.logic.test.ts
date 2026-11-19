import type { ProjectEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveWikiTarget,
  rewriteWikiLinks,
  taskMarkerOffsetInSource,
  wikiLinkTargets,
  wikiSearchName,
} from "./wikiLinks.logic";

const link = (index: number) => `t3-context://v1/vault-note/${index}`;
const files = (...paths: ReadonlyArray<string>): ReadonlyArray<ProjectEntry> =>
  paths.map((path) => ({ path, kind: "file" }));

describe("wikiLinkTargets", () => {
  it("lists every linked and embedded target once, in reading order", () => {
    const text = [
      "See [[Plan]], [[Plan#Budget|the budget]] and [[folder/Note.md]].",
      "![[photo.png|300]] ![[Other note]] [[#Only a heading]]",
      "| a | [[Table note\\|alias]] |",
    ].join("\n");
    expect(wikiLinkTargets(text)).toEqual([
      "Plan",
      "folder/Note.md",
      "photo.png",
      "Other note",
      "Table note",
    ]);
    expect(wikiLinkTargets(text).map(wikiSearchName)).toEqual([
      "Plan",
      "Note.md",
      "photo.png",
      "Other note",
      "Table note",
    ]);
  });

  it("ignores links inside code", () => {
    const text =
      "`[[inline]]` and ``a ` [[double]]``\n```md\n[[fenced]]\n```\n~~~\n[[tilde]]\n~~~\n[[real]]";
    expect(wikiLinkTargets(text)).toEqual(["real"]);
  });
});

describe("taskMarkerOffsetInSource", () => {
  it("finds a checkbox of the rewritten note in the note as written", () => {
    const source = "See [[Plan]]\n- [ ] Ask [[Ana]]\n  - [x] Book [[Trip|the trip]]";
    const rewritten = rewriteWikiLinks(source, () => null);
    const second = rewritten.indexOf("[x]");
    expect(rewritten.length).not.toBe(source.length);
    expect([
      taskMarkerOffsetInSource(source, rewritten, rewritten.indexOf("[ ]")),
      taskMarkerOffsetInSource(source, rewritten, second),
    ]).toEqual([source.indexOf("[ ]"), source.indexOf("[x]")]);
  });
});

describe("rewriteWikiLinks", () => {
  it("turns links into context links labelled the Obsidian way", () => {
    expect(rewriteWikiLinks("[[Plan]] [[Plan#Budget]] [[Plan|my plan]] [[Q&A]]", () => null)).toBe(
      `[Plan](${link(0)}) [Plan \\> Budget](${link(0)}) [my plan](${link(0)}) [Q\\&A](${link(1)})`,
    );
    expect(rewriteWikiLinks("[[folder/Note#^block1]]", () => null)).toBe(
      `[folder\\/Note \\> block1](${link(0)})`,
    );
  });

  it("shows a link to a heading of the same note as plain text", () => {
    expect(rewriteWikiLinks("Jump to [[#Next steps]].", () => null)).toBe("Jump to Next steps.");
  });

  it("embeds resolved images and links everything else", () => {
    const text = "![[photo.png|300]] ![[missing.png]] ![[Other note]]";
    expect(
      rewriteWikiLinks(text, (target) =>
        target === "photo.png" ? "/v/attachments/photo.png" : null,
      ),
    ).toBe(
      `![photo\\.png](</v/attachments/photo.png>) [missing\\.png](${link(1)}) [Other note](${link(2)})`,
    );
  });

  it("leaves code alone", () => {
    const text = "`[[inline]]`\n```\n[[fenced]]\n```\n[[real]]";
    expect(rewriteWikiLinks(text, () => null)).toBe(
      `\`[[inline]]\`\n\`\`\`\n[[fenced]]\n\`\`\`\n[real](${link(0)})`,
    );
  });
});

describe("resolveWikiTarget", () => {
  const vault = files(
    "Plan.md",
    "projects/Plan.md",
    "projects/lisbon/Flat.md",
    "archive/lisbon/Flat.md",
    "Areas/Health/Flat.md",
    "attachments/photo.png",
    "projects/x/attachments/photo.png",
    ".trash/Ghost.md",
    "notes/Q&A.md",
    "Release.v2.md",
  );

  it("takes the exact path from the vault's top first, with or without .md", () => {
    expect(resolveWikiTarget("Plan", vault)).toBe("Plan.md");
    expect(resolveWikiTarget("projects/Plan", vault)).toBe("projects/Plan.md");
    expect(resolveWikiTarget("projects/Plan.md", vault)).toBe("projects/Plan.md");
  });

  it("finds a unique name anywhere, ignoring case", () => {
    expect(resolveWikiTarget("q&a", vault)).toBe("notes/Q&A.md");
    expect(resolveWikiTarget("Release.v2", vault)).toBe("Release.v2.md");
  });

  it("picks the shortest path when a name is in several folders", () => {
    expect(resolveWikiTarget("Flat", vault)).toBe("Areas/Health/Flat.md");
    expect(resolveWikiTarget("photo.png", vault)).toBe("attachments/photo.png");
    expect(resolveWikiTarget("lisbon/Flat", vault)).toBe("archive/lisbon/Flat.md");
    expect(resolveWikiTarget("projects/lisbon/Flat", vault)).toBe("projects/lisbon/Flat.md");
  });

  it("finds nothing in hidden folders or for names that are not there", () => {
    expect(resolveWikiTarget("Ghost", vault)).toBeNull();
    expect(resolveWikiTarget("Missing", vault)).toBeNull();
    expect(resolveWikiTarget("health/plan", vault)).toBeNull();
    expect(resolveWikiTarget("  ", vault)).toBeNull();
  });
});
