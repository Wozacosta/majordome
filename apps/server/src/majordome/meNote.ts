/**
 * `me.md`: the owner's facts that stay true (name, address, phone, employer, family), which a form,
 * a booking or a letter asks for. Its first two parts go into every conversation; the rest is read
 * when needed. Identity and bank numbers are not in it: they are saved keys, and the note names
 * them. Kept free of server imports so the evals read the same text a run gets.
 */

export const ME_DEFAULT_PATH = "me.md";

/** The parts every conversation is given: harmless, and asked for by almost any task. */
const LOADED_HEADINGS = ["Me", "Contact"] as const;
const ON_DEMAND_HEADINGS = [
  "Work",
  "Identity documents",
  "Money",
  "Household",
  "Emergency contact",
] as const;
const HEADINGS = [...LOADED_HEADINGS, ...ON_DEMAND_HEADINGS];

/** A hand-written note can grow; what is loaded everywhere stays small. */
const LOADED_CHAR_LIMIT = 1_500;

/** Model-facing, and in the note itself: the numbers that are saved keys, never written in a note. */
export const NUMBERS_KEPT_AS_SAVED_KEYS =
  "passport, ID card, driving licence, tax, social security or bank account number";

/** What the owner said about themselves when the notes were started. */
export interface MeAbout {
  readonly name?: string | undefined;
  /** A BCP 47 tag, as the browser gives it. */
  readonly language?: string | undefined;
  readonly timeZone?: string | undefined;
}

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

const oneLine = (value: string | undefined) => value?.replaceAll(/\s+/g, " ").trim() ?? "";

/** The note a new notes folder starts with, holding what the owner gave at setup. */
export function meTemplate(about: MeAbout = {}): string {
  const name = oneLine(about.name);
  const language = oneLine(about.language);
  const timeZone = oneLine(about.timeZone);
  const facts: Record<string, ReadonlyArray<string>> = {
    Me: [
      ...(name === "" ? [] : [`- Name: ${name}`]),
      ...(language === "" ? [] : [`- Language: ${languageName(language)}`]),
      ...(timeZone === "" ? [] : [`- Time zone: ${timeZone}`]),
    ],
  };
  return [
    "# About me",
    "",
    "Facts that stay true, for forms, bookings and letters. One per line, as `- Label: value`.",
    `A ${NUMBERS_KEPT_AS_SAVED_KEYS} is not written here: it is kept encrypted in Passwords and keys, and this note only names it.`,
    ...HEADINGS.flatMap((heading) => ["", `## ${heading}`, ...(facts[heading] ?? [])]),
    "",
  ].join("\n");
}

/** The lines under the note's `## Me` and `## Contact`, each part under its heading. */
function loadedParts(text: string): string {
  const parts: Array<string> = [];
  let current: { readonly heading: string; readonly lines: Array<string> } | null = null;
  const close = () => {
    if (current !== null && current.lines.length > 0) {
      parts.push([`## ${current.heading}`, ...current.lines].join("\n"));
    }
  };
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      close();
      const wanted = LOADED_HEADINGS.find(
        (name) => name.toLowerCase() === heading[1]?.toLowerCase(),
      );
      current = wanted === undefined ? null : { heading: wanted, lines: [] };
    } else if (current !== null && line.trim() !== "") {
      current.lines.push(line.trimEnd());
    }
  }
  close();
  const loaded = parts.join("\n");
  return loaded.length <= LOADED_CHAR_LIMIT
    ? loaded
    : `${loaded.slice(0, LOADED_CHAR_LIMIT)}\n[Cut here: read the file for the rest.]`;
}

const NAME_LINE = /^- Name:[ \t]*(.*)$/m;

/** The name the note gives its owner, or null when it has none. */
export function ownerName(text: string | null): string | null {
  const name = text === null ? "" : (NAME_LINE.exec(text)?.[1]?.trim() ?? "");
  return name === "" ? null : name;
}

/** The note with its owner called `name`: the line is replaced, or added first under `## Me`. */
export function withOwnerName(text: string | null, name: string): string {
  const line = `- Name: ${oneLine(name)}`;
  if (text === null || text.trim() === "") return meTemplate({ name });
  if (NAME_LINE.test(text)) return text.replace(NAME_LINE, line);
  const heading = /^## Me[ \t]*$/m.exec(text);
  if (heading === null) return `${text.trimEnd()}\n\n## Me\n${line}\n`;
  const after = heading.index + heading[0].length;
  return `${text.slice(0, after)}\n${line}${text.slice(after)}`;
}

/** True once the note has a line under `## Contact`: an address, a phone number or an email. */
export function hasContact(text: string | null): boolean {
  return text !== null && /^## Contact\n\S/m.test(loadedParts(text));
}

/** Model-facing: what the note holds, when to read the rest, and where a new fact goes. */
export function aboutUserSection(input: {
  readonly path: string;
  /** Null when the notes have no such note yet. */
  readonly text: string | null;
}): string {
  const { path } = input;
  const loaded = input.text === null ? "" : loadedParts(input.text);
  const rest = ON_DEMAND_HEADINGS.join(", ");
  const opening =
    input.text === null
      ? [
          `${path} is the note for the user's facts that stay true, which forms, bookings and letters ask for. It does not exist yet: create it the first time you have such a fact, with these headings in this order: ${HEADINGS.map((heading) => `\`## ${heading}\``).join(", ")}.`,
        ]
      : [
          `${path} holds the user's facts that stay true, which forms, bookings and letters ask for. ${loaded === "" ? 'Its "Me" and "Contact" parts are empty so far.' : 'Its "Me" and "Contact" parts:'}`,
          ...(loaded === "" ? [] : [loaded]),
          `The rest (${rest}) is in the file and not loaded here. Read ${path} before you fill in a form, make a booking or write a letter for the user, and never guess a fact it may hold.`,
        ];
  return [
    `<about_user path="${path.replaceAll('"', "&quot;")}">`,
    ...opening,
    `When a task needs a fact that is not there, search the notes for it (\`search_notes\`) before you ask the user; do not ask for these facts ahead of need. When the user tells you one, or you find one in their notes, write it in ${path} under the matching heading as \`- Label: value\`, replacing the line that has that label.`,
    `A ${NUMBERS_KEPT_AS_SAVED_KEYS} never goes in ${path} or any other note. Save it with \`save_key\` (a name such as \`passport-number\`, a note saying what it is, and \`expires\` when the document has an end date) and write only its name in ${path}: \`- Passport: saved key passport-number, expires 2031-04-02\`. When a form or a letter needs the number, take it with \`use_saved_key\` and fill it in from its file. When the user asks what the number is, answer with the masked form that tool returns; say it in full only when they need to type it themselves or ask for all of it, and repeat it nowhere else.`,
    "</about_user>",
  ].join("\n");
}
