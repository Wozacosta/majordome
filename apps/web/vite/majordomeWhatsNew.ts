// The app shows its own changelog: the build carries the notes of the version it is.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeFS from "node:fs";

export interface WhatsNewSource {
  readonly version: string;
  readonly notes: string;
}

const RELEASED_HEADING = /^## (\d+\.\d+\.\d+\S*)$/;

/**
 * The notes of `version`, else of the newest released version: a build made between releases
 * has no section of its own yet.
 */
export function whatsNewFromChangelog(changelog: string, version: string): WhatsNewSource | null {
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
  return written.find((section) => section.version === version) ?? written[0] ?? null;
}

export function readWhatsNew(changelogPath: string, version: string): WhatsNewSource | null {
  try {
    return whatsNewFromChangelog(NodeFS.readFileSync(changelogPath, "utf8"), version);
  } catch {
    return null;
  }
}
