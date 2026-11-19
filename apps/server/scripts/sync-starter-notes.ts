// @effect-diagnostics nodeBuiltinImport:off - standalone generation uses synchronous Node I/O.
// @effect-diagnostics globalConsole:off - standalone maintenance command output.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { format } from "vite-plus/fmt";

import { collectStarterNotes } from "./starter-notes.ts";

const target = new URL("../src/majordome/starterNotes.json", import.meta.url);
const obrain = NodePath.join(import.meta.dirname, "../../../packages/obrain");
const formatted = await format(
  "starterNotes.json",
  JSON.stringify(await collectStarterNotes(obrain)),
);
if (formatted.errors.length > 0) throw new Error("Could not format the starter notes.");
NodeFS.writeFileSync(target, formatted.code);
console.log("Generated the starter notes from packages/obrain.");
