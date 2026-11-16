/** A vault as the eval holds it: path to contents. */
export type Files = Readonly<Record<string, string>>;

export interface Checks {
  /** No file may be created, changed or deleted. */
  readonly noChanges?: boolean;
  /** Files that must be exactly as they were. */
  readonly unchanged?: ReadonlyArray<string>;
  /** A file that must match every pattern (case-insensitive regular expressions). */
  readonly contains?: ReadonlyArray<{
    readonly path: string;
    readonly all: ReadonlyArray<string>;
    readonly label: string;
  }>;
  /** A file that must not match the pattern. */
  readonly lacks?: ReadonlyArray<{
    readonly path: string;
    readonly pattern: string;
    readonly label: string;
  }>;
  /** Text that may appear in no file but those listed, and not in the reply. */
  readonly nowhereBut?: ReadonlyArray<{
    readonly text: string;
    readonly files: ReadonlyArray<string>;
    readonly label: string;
  }>;
  /** A file that must end up shorter than `below` characters, and shorter than it started. */
  readonly shorter?: { readonly path: string; readonly below: number };
  /** Patterns the final reply must match. */
  readonly reply?: ReadonlyArray<{ readonly pattern: string; readonly label: string }>;
}

const matches = (text: string, pattern: string) => new RegExp(pattern, "i").test(text);

export function grade(input: {
  readonly before: Files;
  readonly after: Files;
  readonly reply: string;
  readonly checks: Checks;
}): { readonly pass: boolean; readonly failures: ReadonlyArray<string> } {
  const { before, after, reply, checks } = input;
  const failures: Array<string> = [];
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (path) => before[path] !== after[path],
  );

  if (checks.noChanges && changed.length > 0) failures.push(`changed ${changed.join(", ")}`);
  for (const path of checks.unchanged ?? []) {
    if (changed.includes(path)) failures.push(`${path} was edited`);
  }
  for (const check of checks.contains ?? []) {
    const text = after[check.path] ?? "";
    const missing = check.all.filter((pattern) => !matches(text, pattern));
    if (missing.length > 0)
      failures.push(`${check.label}: ${check.path} lacks ${missing.join(", ")}`);
  }
  for (const check of checks.lacks ?? []) {
    if (matches(after[check.path] ?? "", check.pattern)) {
      failures.push(`${check.label}: ${check.path} has ${check.pattern}`);
    }
  }
  for (const check of checks.nowhereBut ?? []) {
    const leaked = Object.entries(after)
      .filter(([path, text]) => !check.files.includes(path) && text.includes(check.text))
      .map(([path]) => path);
    if (reply.includes(check.text)) leaked.push("the reply");
    if (leaked.length > 0) failures.push(`${check.label}: copied into ${leaked.join(", ")}`);
  }
  if (checks.shorter !== undefined) {
    const length = (after[checks.shorter.path] ?? "").trim().length;
    const was = (before[checks.shorter.path] ?? "").trim().length;
    if (length >= checks.shorter.below || length >= was) {
      failures.push(`${checks.shorter.path} is ${length} characters (was ${was})`);
    }
  }
  for (const check of checks.reply ?? []) {
    if (!matches(reply, check.pattern)) failures.push(`reply: ${check.label}`);
  }
  return { pass: failures.length === 0, failures };
}
