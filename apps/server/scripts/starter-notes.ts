// @effect-diagnostics nodeBuiltinImport:off - standalone generation uses synchronous Node I/O.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/** What a new notes folder starts with, read from obrain, the one source for it. */
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
    instructions: read("templates", "AGENTS.md"),
    instructionsImport: brain.IMPORT_STUB,
    memoryFile: brain.MAJORDOME_CONFIG.memory,
    memory: read("templates", "memory.md"),
    config: `${JSON.stringify(brain.MAJORDOME_CONFIG, null, 2)}\n`,
    skills: Object.fromEntries(
      brain.skillNames().map((name) => [name, read("skills", name, "SKILL.md")]),
    ),
  };
}
