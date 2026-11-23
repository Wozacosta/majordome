const SKILL_PATH = /^\.(?:agents\/(?:proposed-)?skills|claude\/skills)\/([^/]+)\//;

/** A skill's folder name as a person reads it: `file-receipts` is "File receipts". */
export function skillTitle(name: string): string {
  const words = name.replaceAll(/[_-]+/g, " ").trim();
  return words === "" ? name : words[0]!.toUpperCase() + words.slice(1);
}

/** The skill a changed file belongs to, or null for any other file. */
export const skillOfPath = (path: string): string | null => SKILL_PATH.exec(path)?.[1] ?? null;
