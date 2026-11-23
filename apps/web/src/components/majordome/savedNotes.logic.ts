import { feedNoteTitle, feedVaultNotes } from "./feed.logic";
import { skillOfPath } from "./skills.logic";

const NO_VAULT_NOTES = feedVaultNotes({});

interface SavedNote {
  readonly path: string;
  readonly title: string;
  /** The folder as words, "Personal / Fitness", or null at the top of the notes. */
  readonly folder: string | null;
  readonly openable: boolean;
}

function folderWords(path: string): string | null {
  const parts = path.split("/").slice(0, -1);
  if (parts.length === 0) return null;
  return parts
    .map((part) => {
      const words = part.replaceAll(/[_-]+/g, " ").trim();
      return words === "" ? part : words[0]!.toUpperCase() + words.slice(1);
    })
    .join(" / ");
}

/**
 * The notes a reply changed, as a person names them, and the skills it wrote for itself, which
 * wait for the owner. Majordome's own bookkeeping is left out.
 */
export function savedNotes(
  files: ReadonlyArray<string>,
  nowMs: number,
  max = 5,
): {
  readonly shown: ReadonlyArray<SavedNote>;
  readonly more: number;
  readonly skills: ReadonlyArray<string>;
} {
  const skills = new Set(files.map(skillOfPath).filter((name) => name !== null));
  const notes = files
    .filter((path) => !path.startsWith(".majordome/") && skillOfPath(path) === null)
    .map((path) => ({
      path,
      title: feedNoteTitle(path, NO_VAULT_NOTES, nowMs),
      folder: folderWords(path),
      openable: path.endsWith(".md"),
    }));
  return {
    shown: notes.slice(0, max),
    more: Math.max(0, notes.length - max),
    skills: [...skills],
  };
}
