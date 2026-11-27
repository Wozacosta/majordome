export interface Checks {
  readonly noTable?: boolean;
  readonly noList?: boolean;
  readonly noHeading?: boolean;
  readonly noCode?: boolean;
  readonly maxWords?: number;
  /** Case-insensitive patterns the reply must match. */
  readonly mentions?: ReadonlyArray<{ readonly pattern: string; readonly label: string }>;
  /** The reply must use a table or a list: nothing asked it to be spoken. */
  readonly structured?: boolean;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/m;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+\S/m;
const HEADING = /^\s{0,3}#{1,6}\s+\S/m;
const CODE = /```|~~~|`[^`\n]+`/;

export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function grade(
  reply: string,
  checks: Checks,
): { readonly pass: boolean; readonly failures: ReadonlyArray<string> } {
  const failures: Array<string> = [];
  if (reply.trim() === "") failures.push("empty reply");
  if (checks.noTable && TABLE_ROW.test(reply)) failures.push("has a table");
  if (checks.noList && LIST_ITEM.test(reply)) failures.push("has a list");
  if (checks.noHeading && HEADING.test(reply)) failures.push("has a heading");
  if (checks.noCode && CODE.test(reply)) failures.push("has code");
  if (checks.maxWords !== undefined && wordCount(reply) > checks.maxWords) {
    failures.push(`${wordCount(reply)} words, over ${checks.maxWords}`);
  }
  for (const mention of checks.mentions ?? []) {
    if (!new RegExp(mention.pattern, "i").test(reply)) failures.push(mention.label);
  }
  if (checks.structured && !TABLE_ROW.test(reply) && !LIST_ITEM.test(reply)) {
    failures.push("neither a table nor a list");
  }
  return { pass: failures.length === 0, failures };
}
