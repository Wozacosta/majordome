/**
 * The nightly memory pass ("Tidy my memory"): its prompt, and the list of changed notes the server
 * puts in front of it. Kept free of server imports so the eval in `evals/memory-pass` reads the
 * same text a run gets.
 */

export const MEMORY_CHAR_LIMIT = 8_000;

/** Every default routine starts by deferring to the vault's own rules. */
export const VAULT_CONVENTIONS =
  "Follow the conventions in AGENTS.md at the vault root, and use the vault's own skills or commands for this when it has them.";
/** Past this the pass shortens memory before it adds to it. */
const MEMORY_TIDY_AT = MEMORY_CHAR_LIMIT - 1_000;

const MEMORY_PASS_TASK = /^majordome:.+:tidy-my-memory$/;

/** True for the scheduled task that is a vault's memory pass (see `routineTaskId`). */
export const isMemoryPassTask = (taskId: string) => MEMORY_PASS_TASK.test(taskId);

/** What the server found for one pass, when the schedule let it through. */
export interface MemoryPassBrief {
  /** When the pass before this one was prepared; null for the first pass on this server. */
  readonly since: string | null;
  readonly preparedAt: string;
  /** Notes that changed since then and still exist, newest change first. */
  readonly files: ReadonlyArray<string>;
  /** Changed notes left out of `files`. */
  readonly more: number;
  readonly memoryChars: number;
}

const count = (value: number) => value.toLocaleString("en-US");

/** The pass's part of the vault context. */
export function memoryPassSection(input: {
  readonly brief: MemoryPassBrief;
  readonly memoryPath: string;
}): string {
  const { brief } = input;
  const lines = [
    brief.since === null ? `<memory_pass first="true">` : `<memory_pass since="${brief.since}">`,
    brief.files.length === 0
      ? "No note changed since the last memory pass."
      : brief.since === null
        ? "This is the first memory pass here. Notes that changed in the last week, newest first:"
        : "Notes that changed since the last memory pass, newest first:",
    ...brief.files.map((file) => `- ${file}`),
  ];
  if (brief.more > 0) lines.push(`- …and ${count(brief.more)} more`);
  lines.push(
    `${input.memoryPath} is ${count(brief.memoryChars)} characters; its limit is ${count(MEMORY_CHAR_LIMIT)}.`,
    "</memory_pass>",
  );
  return lines.join("\n");
}

export function memoryPassPrompt(input: {
  readonly memory: string;
  readonly dailyFolder: string;
}): string {
  const { memory, dailyFolder } = input;
  return [
    `Go through what is new in this vault and keep what is worth remembering. ${VAULT_CONVENTIONS}`,
    "",
    "What to read",
    `1. The \`<memory_pass>\` block at the start of this conversation lists the notes that changed since the last pass. Read those. If there is no such block, read today's and yesterday's daily notes in \`${dailyFolder}/\` and any other note you can tell changed in the last two days.`,
    `2. Read \`${memory}\` from the file, since the copy loaded above may be cut, and \`.majordome/topics.json\`, which lists my topics and the folder each one keeps its notes in.`,
    "",
    "What to keep",
    "Keep what will still matter in a month: facts about me and the people in my life, decisions, preferences, commitments with their dates, and how I do things that come back. Leave out passing remarks, moods, things that are done and over, anything already recorded, and anything you would have to guess. When a note is unclear or two notes disagree, do not record a guess: ask me in your summary.",
    "Never copy a password, PIN, card number, security code, API key, token or recovery phrase into memory or any other note. Leave it where it is, and tell me in the summary which note holds one, without repeating it. An IBAN, an address or a phone number is not a secret.",
    "",
    "Where each thing goes",
    `- Write each item as one short line: the date I said it or it was decided, the fact, and a link to the note it came from, linked the way this vault's notes link. For example: \`- 2026-11-14: My accountant is Ana; she prefers email. ([daily note](${dailyFolder}/2026-11-14.md))\``,
    `- \`${memory}\` is loaded into every conversation, so it only gets what you should know whatever we talk about.`,
    "- What belongs to one topic or project goes in that subject's own note: the `log.md` of the topic's folder (newest last), or the project's note. Create `log.md` in a topic's folder when it is missing; do not create folders or topics.",
    "- When a new fact replaces an old one, replace the old line and keep the new fact with its date.",
    `- Keep the headings, order and language \`${memory}\` already has.`,
    "",
    "Keep memory small",
    `\`${memory}\` must stay under ${count(MEMORY_CHAR_LIMIT)} characters; past that, its end is not loaded. When it is over about ${count(MEMORY_TIDY_AT)}, shorten it before you add to it: merge lines that say the same thing, drop what a newer line replaced or what is clearly over (keep the newer fact and its date), and move lines about one topic or project into that subject's note. Never cut the end off, and never drop a line without telling me: your summary lists everything merged, moved or dropped. Below that size, leave the existing lines alone.`,
    "",
    "Do not touch",
    `- My own words. Never edit, reorder or delete anything in my daily notes or in notes I wrote; this routine only adds to \`${memory}\` and to topic or project notes.`,
    "- `CLAUDE.md` and `AGENTS.md`. Never edit them; if something belongs there, say so in the summary.",
    "- You need no shell command for this. Read, search and edit the notes directly.",
    "",
    "Finish with a short summary in plain words, which I read in my feed:",
    '- Its first sentence says what you did, such as "Remembered 3 things from yesterday."',
    "- Then what you remembered, each with a link to where you put it.",
    "- Then what you merged, moved or dropped.",
    "- Then anything you were not sure about, as a question I can answer later.",
    'If nothing was worth keeping and memory needs no shortening, change no file and reply with one line: "Nothing new to remember."',
  ].join("\n");
}
