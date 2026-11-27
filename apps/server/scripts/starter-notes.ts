// @effect-diagnostics nodeBuiltinImport:off - standalone generation uses synchronous Node I/O.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/** obrain's own onboarding: it opens Obsidian and rewrites AGENTS.md, which the app does itself. */
const LEFT_OUT_SKILL = "brain-setup";

/** Fails when obrain's template no longer has the text Majordome replaces. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`obrain's AGENTS.md no longer has: ${from}`);
  return text.replace(from, to);
}

/** obrain's instructions as Majordome ships them: the owner is in `me.md`, and no setup command. */
function majordomeInstructions(template: string): string {
  const profile = template.slice(
    template.indexOf("## Owner Profile"),
    template.indexOf("## How This Brain Is Organized"),
  );
  const withOwner = swap(
    template,
    profile,
    [
      "## Owner",
      "Who the owner is, and the facts forms and letters ask for (name, address, phone, work,",
      "household), are in me.md. Read it before you write or fill in anything in their name.",
      "",
      "",
    ].join("\n"),
  );
  const withNote = swap(
    withOwner,
    "  memory.md   — what the agent has learned about how the owner works\n",
    "  memory.md   — what the agent has learned about how the owner works\n  me.md       — the owner's own facts: name, contact, work, household\n",
  );
  const setupLine = withNote.split("\n").find((line) => line.startsWith(`- /${LEFT_OUT_SKILL}`));
  return swap(withNote, `${setupLine}\n`, "");
}

/** A new memory note: only what the nightly pass needs to keep its lines in order. */
const MEMORY = [
  "# Memory",
  "",
  "What your assistant has learned about how you work. Every chat starts with this note.",
  "",
  "## Preferences",
  "",
  "## Decisions and dates",
  "",
].join("\n");

/** What a new notes folder starts with: obrain's, less what Majordome does itself. */
export async function collectStarterNotes(obrainRoot: string) {
  const read = (...parts: ReadonlyArray<string>) =>
    NodeFS.readFileSync(NodePath.join(obrainRoot, ...parts), "utf8");
  const brain: {
    readonly FOLDERS: ReadonlyArray<string>;
    readonly IMPORT_STUB: string;
    readonly MAJORDOME_CONFIG: { readonly memory: string };
    readonly skillNames: () => ReadonlyArray<string>;
  } = await import(NodeURL.pathToFileURL(NodePath.join(obrainRoot, "lib", "brain.mjs")).href);
  return {
    folders: brain.FOLDERS,
    instructions: majordomeInstructions(read("templates", "AGENTS.md")),
    instructionsImport: brain.IMPORT_STUB,
    memoryFile: brain.MAJORDOME_CONFIG.memory,
    memory: MEMORY,
    config: `${JSON.stringify(brain.MAJORDOME_CONFIG, null, 2)}\n`,
    skills: Object.fromEntries(
      brain
        .skillNames()
        .filter((name) => name !== LEFT_OUT_SKILL)
        .map((name) => [name, read("skills", name, "SKILL.md")]),
    ),
  };
}
