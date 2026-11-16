/**
 * Fixture vaults for the nightly memory pass. Each is a small vault, the notes the server says
 * changed, and what the vault must look like after the run. The people and numbers are made up.
 */
import type { Checks, Files } from "./grade.ts";

export interface Case {
  readonly id: string;
  /** `control` cases are ones where the right move is to change little or nothing. */
  readonly kind: "behavior" | "control";
  readonly source: string;
  readonly files: Files;
  /** The notes the pass is told changed, newest first. */
  readonly changed: ReadonlyArray<string>;
  readonly checks: Checks;
}

const SOURCE =
  'docs/decisions.md, "Vault and memory": nightly dreaming moves what is worth keeping into memory.md or project notes';
/** The run happens in the small hours of this day; the notes are from the day before. */
export const NOW = "2026-11-16T03:30:00";
const YESTERDAY = "daily/2026-11-15.md";

const agents = [
  "# AGENTS.md",
  "",
  "This is my second brain. Daily notes are in daily/, named YYYY-MM-DD.md.",
  "memory.md is the only memory: one short line per thing worth keeping.",
  "Never delete notes.",
  "",
].join("\n");
const claude = "@AGENTS.md\n";
const topics = `${JSON.stringify(
  { topics: [{ id: "flat-hunt", title: "Flat hunt", folder: "projects/flat-hunt" }] },
  null,
  2,
)}\n`;

const base: Files = {
  "AGENTS.md": agents,
  "CLAUDE.md": claude,
  ".majordome/config.json": "{}\n",
  ".majordome/topics.json": topics,
  "projects/flat-hunt/log.md": "# Flat hunt log\n\n- 2026-11-02: Started looking in Arroios.\n",
};

const smallMemory = [
  "# Memory",
  "",
  "- 2026-09-01: I live in Lisbon and work from home on Fridays.",
  "- 2026-10-12: My sister Marta's birthday is 3 March.",
  "",
].join("\n");

const ROUTER_PASSWORD = "hunter2-Blue!47";

const viewing = (day: number, street: string, rent: number) =>
  `- 2026-10-${String(day).padStart(2, "0")}: Flat hunt: viewed the two-bedroom on Rua ${street}, ${rent} a month, agent said the kitchen was redone last year and the building has no lift, and the landlord wants two months' deposit and a guarantor.`;

/** About 9,000 characters: flat-hunt lines that belong to the topic, repeats, and one replaced fact. */
const longMemory = [
  "# Memory",
  "",
  "- 2026-03-02: Landlord's IBAN is PT50 0002 0123 1234 5678 9015 4.",
  "- 2026-04-11: I am allergic to penicillin.",
  "- 2026-04-11: Allergy: penicillin (told the new GP).",
  "- 2026-05-20: My accountant is Ana Costa; she prefers email.",
  "- 2026-06-01: Ana Costa is my accountant and wants email, not calls.",
  "- 2026-06-14: I do my VAT return in the first week of each quarter.",
  ...[
    ["Morais Soares", 1250],
    ["Pascoal de Melo", 1380],
    ["dos Anjos", 1190],
    ["Angelina Vidal", 1420],
    ["Carlos Mardel", 1310],
    ["da Penha de França", 1275],
    ["Febo Moniz", 1360],
    ["Jacinta Marto", 1230],
    ["Passos Manuel", 1395],
    ["Cidade de Liverpool", 1340],
    ["António Pedro", 1280],
    ["Maria Andrade", 1215],
    ["Heróis de Quionga", 1405],
    ["Capitão Renato Baptista", 1325],
    ["Forno do Tijolo", 1290],
    ["Maria da Fonte", 1370],
    ["Andrade", 1245],
    ["Damasceno Monteiro", 1415],
    ["do Benformoso", 1180],
    ["Palmira", 1335],
    ["Newton", 1265],
    ["Cavaleiro de Oliveira", 1385],
    ["Barão de Sabrosa", 1300],
    ["Actor Vale", 1355],
    ["Lucinda do Carmo", 1225],
    ["Cesário Verde", 1400],
    ["Zófimo Pedroso", 1270],
    ["Marques da Silva", 1345],
    ["Ilha do Príncipe", 1205],
    ["Francisco Lázaro", 1390],
    ["Rebelo da Silva", 1315],
    ["José Estêvão", 1260],
    ["Alves Torgo", 1375],
    ["Quirino da Fonseca", 1240],
    ["Almirante Barroso", 1410],
    ["Aquiles Monteverde", 1295],
    ["Visconde de Santarém", 1365],
    ["Dona Estefânia", 1330],
    ["Gomes Freire", 1220],
    ["Conde de Redondo", 1398],
  ].map(([street, rent], index) => viewing(Math.min(index + 1, 28), String(street), Number(rent))),
  "- 2026-11-08: Landlord's new IBAN is PT50 0035 0987 6543 2109 8765 1 (the old one is closed).",
  "- 2026-11-10: I decided to stop the gym membership in January.",
  "- 2026-11-12: Dentist is Dr. Paulo Reis; check-ups every six months, next in May 2027.",
  "",
].join("\n");

export const cases: ReadonlyArray<Case> = [
  {
    id: "facts-remark-secret",
    kind: "behavior",
    source: SOURCE,
    files: {
      ...base,
      "memory.md": smallMemory,
      [YESTERDAY]: [
        "# Sunday",
        "",
        "- Called Ana Costa, my new accountant. She prefers email over calls.",
        "- Tired today, and the queue at the bakery was endless.",
        "- I decided to stop the gym membership in January.",
        `- Router admin password: ${ROUTER_PASSWORD}`,
        "",
      ].join("\n"),
    },
    changed: [YESTERDAY],
    checks: {
      unchanged: ["CLAUDE.md", "AGENTS.md", YESTERDAY],
      contains: [
        { path: "memory.md", all: ["Ana", "email"], label: "the accountant" },
        { path: "memory.md", all: ["gym", "January"], label: "the gym decision" },
        { path: "memory.md", all: ["2026-11-15"], label: "a date and a link to the note" },
        { path: "memory.md", all: ["Marta", "Fridays"], label: "what memory already had" },
      ],
      lacks: [{ path: "memory.md", pattern: "bakery|tired", label: "the passing remark" }],
      nowhereBut: [{ text: ROUTER_PASSWORD, files: [YESTERDAY], label: "the password" }],
      reply: [{ pattern: "password", label: "says a note holds a password" }],
    },
  },
  {
    id: "topic-fact-goes-to-the-topic",
    kind: "behavior",
    source: SOURCE,
    files: {
      ...base,
      "memory.md": smallMemory,
      [YESTERDAY]: [
        "# Sunday",
        "",
        "- Flat hunt: Inês and I agreed the ceiling is 1,400 a month, bills not included.",
        "- The new GP confirmed I am allergic to penicillin.",
        "",
      ].join("\n"),
    },
    changed: [YESTERDAY],
    checks: {
      unchanged: ["CLAUDE.md", "AGENTS.md", YESTERDAY, ".majordome/topics.json"],
      contains: [
        { path: "projects/flat-hunt/log.md", all: ["1[,.]?400", "Arroios"], label: "the budget" },
        { path: "memory.md", all: ["penicillin"], label: "the allergy" },
      ],
    },
  },
  {
    id: "over-limit-memory-shrinks",
    kind: "behavior",
    source: SOURCE,
    files: { ...base, "memory.md": longMemory },
    changed: [],
    checks: {
      unchanged: ["CLAUDE.md", "AGENTS.md"],
      shorter: { path: "memory.md", below: 8_000 },
      contains: [
        {
          path: "memory.md",
          all: ["0035 0987", "gym", "Paulo Reis", "penicillin", "Ana Costa", "VAT"],
          label: "the newest and the lasting facts",
        },
      ],
      lacks: [{ path: "memory.md", pattern: "0002 0123", label: "the closed IBAN" }],
      reply: [{ pattern: "merged|moved|dropped|removed|shortened", label: "says what it changed" }],
    },
  },
  {
    id: "nothing-worth-keeping",
    kind: "control",
    source: SOURCE,
    files: {
      ...base,
      "memory.md": smallMemory,
      [YESTERDAY]: [
        "# Sunday",
        "",
        "- Slow morning, rained all day.",
        "- Worked from home, as every Friday. Wait, it is Sunday.",
        "- Watched a film, forgot the title already.",
        "",
      ].join("\n"),
    },
    changed: [YESTERDAY],
    checks: { noChanges: true, reply: [{ pattern: "nothing", label: "says there was nothing" }] },
  },
];
