import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isHiddenVaultPath,
  noteKind,
  notesLink,
  type NotesVault,
  pickWikiEmbedPath,
  rewriteWikiImageEmbeds,
  selectNotesVault,
  validateNotesSearch,
  vaultLinkTarget,
  wikiImageEmbeds,
} from "./notes.logic";

const vault = (projectId: string, environmentId = "local"): NotesVault => ({
  environmentId: EnvironmentId.make(environmentId),
  projectId: ProjectId.make(projectId),
  title: projectId,
  workspaceRoot: `/Users/me/${projectId}`,
});

describe("isHiddenVaultPath", () => {
  it("hides plumbing folders, dotfiles and everything below them", () => {
    for (const path of [
      ".git",
      ".majordome/config.json",
      ".agents",
      ".claude/settings.json",
      ".obsidian/workspace.json",
      ".trash/old.md",
      ".DS_Store",
      "projects/.hidden-note.md",
      "node_modules",
      "tools/node_modules/x/index.js",
    ]) {
      expect(isHiddenVaultPath(path), path).toBe(true);
    }
  });

  it("keeps notes, attachments and names that merely contain a dot", () => {
    for (const path of [
      "daily/2026-11-15.md",
      "attachments/photo.png",
      "v1.2 notes.md",
      "CLAUDE.md",
    ]) {
      expect(isHiddenVaultPath(path), path).toBe(false);
    }
  });
});

describe("selectNotesVault", () => {
  const brain = vault("brain");
  const work = vault("work");

  it("opens the only vault straight away", () => {
    expect(selectNotesVault([brain], {})).toBe(brain);
  });

  it("opens the vault a link asks for, and the first one otherwise", () => {
    expect(selectNotesVault([brain, work], { projectId: work.projectId })).toBe(work);
    expect(selectNotesVault([brain, work], { projectId: ProjectId.make("gone") })).toBe(brain);
    expect(selectNotesVault([], {})).toBeNull();
  });

  it("tells the same project id apart by environment", () => {
    const remote = vault("brain", "vps");
    expect(
      selectNotesVault([brain, remote], {
        projectId: brain.projectId,
        environmentId: EnvironmentId.make("vps"),
      }),
    ).toBe(remote);
  });
});

describe("notesLink", () => {
  it("builds /notes?project=…&path=… for other screens", () => {
    expect(notesLink({ projectId: ProjectId.make("brain"), path: "daily/2026-11-15.md" })).toEqual({
      to: "/notes",
      search: { project: "brain", path: "daily/2026-11-15.md" },
    });
    expect(
      notesLink({ projectId: ProjectId.make("brain"), environmentId: EnvironmentId.make("vps") }),
    ).toEqual({ to: "/notes", search: { project: "brain", environment: "vps" } });
  });

  it("drops paths that leave the vault or open its plumbing", () => {
    for (const path of ["../secrets.md", ".majordome/config.json", "/"]) {
      expect(notesLink({ projectId: ProjectId.make("brain"), path }).search, path).toEqual({
        project: "brain",
      });
    }
  });

  it("round-trips through the route's search validation", () => {
    const { search } = notesLink({ projectId: ProjectId.make("brain"), path: "./inbox/a.md" });
    expect(validateNotesSearch({ ...search })).toEqual({ project: "brain", path: "inbox/a.md" });
    expect(validateNotesSearch({ project: 3, path: "../x.md" })).toEqual({});
  });
});

describe("noteKind", () => {
  it("picks how a file is shown", () => {
    expect(noteKind("daily/today.md")).toBe("markdown");
    expect(noteKind("attachments/photo.PNG")).toBe("image");
    expect(noteKind("papers/scan.pdf")).toBe("pdf");
    expect(noteKind("data.canvas")).toBe("other");
  });
});

describe("wiki image embeds", () => {
  const text = "Before ![[photo.png]] and ![[folder/chart.jpg|300]] and ![[Other note]] after.";

  it("finds the images a note embeds, not embedded notes", () => {
    expect(wikiImageEmbeds(text)).toEqual(["photo.png", "folder/chart.jpg"]);
  });

  it("rewrites resolved images as standard markdown and leaves the rest", () => {
    expect(
      rewriteWikiImageEmbeds(text, (name) =>
        name === "photo.png" ? "/v/attachments/photo.png" : null,
      ),
    ).toBe(
      "Before ![photo.png](</v/attachments/photo.png>) and ![[folder/chart.jpg|300]] and ![[Other note]] after.",
    );
  });

  it("finds a bare name at its shortest path, outside hidden folders", () => {
    const entries = [
      { path: "projects/x/attachments/photo.png", kind: "file" as const },
      { path: "attachments/photo.png", kind: "file" as const },
      { path: ".trash/photo.png", kind: "file" as const },
      { path: "attachments/photo.png.md", kind: "file" as const },
    ];
    expect(pickWikiEmbedPath("photo.png", entries)).toBe("attachments/photo.png");
    expect(pickWikiEmbedPath("missing.png", entries)).toBeNull();
    expect(pickWikiEmbedPath("folder/chart.jpg", [])).toBe("folder/chart.jpg");
  });
});

describe("vaultLinkTarget", () => {
  const input = { workspaceRoot: "/Users/me/brain", notePath: "projects/plan.md" };

  it("resolves links between notes against the note's folder", () => {
    expect(vaultLinkTarget({ ...input, href: "ideas.md" })).toBe("projects/ideas.md");
    expect(vaultLinkTarget({ ...input, href: "../daily/2026-11-15.md#top" })).toBe(
      "daily/2026-11-15.md",
    );
    expect(vaultLinkTarget({ ...input, href: "My%20Note.md" })).toBe("projects/My Note.md");
    expect(vaultLinkTarget({ ...input, href: "/Users/me/brain/inbox/a.md" })).toBe("inbox/a.md");
  });

  it("leaves web links, anchors and files outside the vault alone", () => {
    for (const href of [
      "https://example.com",
      "mailto:a@b.c",
      "#heading",
      "../../x.md",
      "/etc/hosts",
    ]) {
      expect(vaultLinkTarget({ ...input, href }), href).toBeNull();
    }
  });
});
