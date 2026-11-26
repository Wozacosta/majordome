// The app shows its own changelog: the build carries the notes of the version it is.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeFS from "node:fs";

export interface WhatsNewSource {
  readonly version: string;
  readonly notes: string;
}

export interface WhatsNewBundle extends WhatsNewSource {
  /** The versions before it, newest first: a few, so the build stays small. */
  readonly earlier: ReadonlyArray<WhatsNewSource>;
}

const EARLIER_VERSIONS = 5;

const RELEASED_HEADING = /^## (\d+\.\d+\.\d+\S*)$/;

/**
 * The notes of `version`, else of the newest released version: a build made between releases
 * has no section of its own yet.
 */
export function whatsNewFromChangelog(changelog: string, version: string): WhatsNewBundle | null {
  const sections: WhatsNewSource[] = [];
  let current: { version: string; lines: string[] } | null = null;
  const close = () => {
    if (current)
      sections.push({ version: current.version, notes: current.lines.join("\n").trim() });
    current = null;
  };
  for (const line of changelog.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      close();
      const released = RELEASED_HEADING.exec(line);
      if (released) current = { version: released[1]!, lines: [] };
    } else {
      current?.lines.push(line);
    }
  }
  close();
  const written = sections.filter((section) => section.notes !== "");
  const found = written.findIndex((section) => section.version === version);
  const index = found === -1 ? 0 : found;
  const shown = written[index];
  if (!shown) return null;
  return { ...shown, earlier: written.slice(index + 1, index + 1 + EARLIER_VERSIONS) };
}

export function readWhatsNew(changelogPath: string, version: string): WhatsNewBundle | null {
  try {
    return whatsNewFromChangelog(NodeFS.readFileSync(changelogPath, "utf8"), version);
  } catch {
    return null;
  }
}
