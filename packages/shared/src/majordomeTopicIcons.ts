import type { MajordomeTopicIcon } from "@t3tools/contracts";

/**
 * Words that pick each icon, in English and French, without accents. A trailing `*` matches any
 * word starting with the rest. The first rule with a match wins, so narrower ones come first.
 */
const ICON_KEYWORDS: ReadonlyArray<readonly [MajordomeTopicIcon, ReadonlyArray<string>]> = [
  [
    "bitcoin",
    ["crypto*", "bitcoin*", "btc", "web3", "eth", "ethereum", "blockchain*", "defi", "nft*"],
  ],
  [
    "receipt",
    [
      "tax",
      "taxes",
      "impot*",
      "compta*",
      "accounting",
      "accountant",
      "bookkeeping",
      "invoice*",
      "facture*",
      "receipt*",
      "expense*",
      "depense*",
      "urssaf",
    ],
  ],
  [
    "wallet",
    [
      "financ*",
      "money",
      "budget*",
      "argent",
      "bank*",
      "banque*",
      "invest*",
      "saving*",
      "epargne",
      "bourse",
      "portfolio",
    ],
  ],
  [
    "footprints",
    [
      "run",
      "runs",
      "running",
      "runner",
      "marathon*",
      "jogging",
      "footing",
      "pied",
      "trail",
      "hike*",
      "hiking",
      "rando*",
      "walk*",
      "steps",
    ],
  ],
  [
    "dumbbell",
    [
      "fitness",
      "gym",
      "workout*",
      "sport*",
      "muscu*",
      "training",
      "entrainement*",
      "strength",
      "crossfit",
    ],
  ],
  [
    "heart-pulse",
    [
      "health",
      "sante",
      "nicotine",
      "quit*",
      "smoking",
      "tabac",
      "cigarette*",
      "sleep",
      "sommeil",
      "medical",
      "medecin",
      "doctor",
      "therap*",
      "mental",
      "meditation*",
      "wellbeing",
    ],
  ],
  [
    "languages",
    [
      "chinese",
      "chinois",
      "mandarin",
      "hsk",
      "langue*",
      "language*",
      "english",
      "anglais",
      "spanish",
      "espagnol",
      "portugues*",
      "portugais",
      "japanese",
      "japonais",
      "vocab*",
      "duolingo",
    ],
  ],
  [
    "book-open",
    [
      "learn*",
      "course",
      "courses",
      "cours",
      "study",
      "studies",
      "etude*",
      "reading",
      "lecture*",
      "book*",
      "livre*",
      "school",
      "ecole",
      "universit*",
      "formation*",
      "exam*",
      "apprend*",
      "apprentissage",
    ],
  ],
  [
    "briefcase",
    [
      "work",
      "job",
      "jobs",
      "cv",
      "resume",
      "career*",
      "carriere",
      "travail",
      "boulot",
      "emploi",
      "interview*",
      "entretien*",
      "freelance",
      "business",
      "office",
      "bureau",
    ],
  ],
  [
    "plane",
    ["travel*", "trip*", "voyage*", "vacation*", "vacance*", "holiday*", "flight*", "visa*"],
  ],
  [
    "home",
    [
      "home",
      "house",
      "maison",
      "move",
      "moving",
      "demenag*",
      "lisbon*",
      "appart*",
      "apartment",
      "logement",
      "rent",
      "loyer",
      "renovation*",
      "travaux",
    ],
  ],
  [
    "utensils",
    [
      "food",
      "cuisine",
      "recipe*",
      "recette*",
      "cooking",
      "cook",
      "meal*",
      "repas",
      "nutrition",
      "diet",
      "restaurant*",
    ],
  ],
  [
    "music",
    ["music*", "musique", "guitar*", "piano", "song*", "chanson*", "playlist*", "concert*"],
  ],
  [
    "code",
    [
      "code",
      "coding",
      "dev",
      "develop*",
      "developpement",
      "programming",
      "programmation",
      "software",
      "project",
      "projet",
      "app",
      "website",
    ],
  ],
  [
    "pen-line",
    [
      "writing",
      "write",
      "ecriture",
      "blog*",
      "journal*",
      "article*",
      "newsletter*",
      "essay*",
      "essai*",
      "novel",
      "roman",
      "poem*",
      "poesie",
    ],
  ],
  [
    "users",
    [
      "family",
      "famille",
      "friends",
      "amis",
      "people",
      "kids",
      "enfants",
      "parents",
      "wedding",
      "mariage",
      "relationship*",
      "dating",
    ],
  ],
  ["leaf", ["garden*", "jardin*", "plant*", "potager", "nature", "climate", "climat", "ecolog*"]],
  ["car", ["car", "cars", "voiture*", "vehicle*", "driving", "permis"]],
  ["lightbulb", ["idea*", "idee*", "brainstorm*", "research", "recherche*", "invention*"]],
];

/** Folders that only sort others (`projects`, `areas`…) say nothing about a topic. */
const CONTAINER_FOLDERS = new Set([
  "project",
  "projects",
  "projets",
  "area",
  "areas",
  "resources",
  "topics",
  "notes",
  "personal",
  "perso",
]);

function wordsOf(text: string): ReadonlyArray<string> {
  return (
    text
      .normalize("NFKD")
      .replaceAll(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}

function iconForWords(words: ReadonlyArray<string>): MajordomeTopicIcon | null {
  for (const [icon, keywords] of ICON_KEYWORDS) {
    const hit = keywords.some((keyword) =>
      keyword.endsWith("*")
        ? words.some((word) => word.startsWith(keyword.slice(0, -1)))
        : words.includes(keyword),
    );
    if (hit) return icon;
  }
  return null;
}

/**
 * The icon a topic gets when the owner chose none: from its title, else from its folder's names,
 * deepest first, skipping the ones that only sort folders. `hash` when nothing matches.
 */
export function autoTopicIcon(title: string, folder: string): MajordomeTopicIcon {
  const segments = folder
    .split("/")
    .map((segment) => segment.replace(/^\d+[\s._-]+/, ""))
    .filter((segment) => !CONTAINER_FOLDERS.has(segment.toLowerCase()))
    // The phone's engine has no toReversed; filter already made a fresh array.
    .reverse();
  for (const text of [title, ...segments]) {
    const icon = iconForWords(wordsOf(text));
    if (icon !== null) return icon;
  }
  return "hash";
}

export function topicIcon(topic: {
  readonly title: string;
  readonly folder: string;
  readonly icon?: MajordomeTopicIcon | undefined;
}): MajordomeTopicIcon {
  return topic.icon ?? autoTopicIcon(topic.title, topic.folder);
}

const TOPIC_TONES = [
  "amber",
  "orange",
  "rose",
  "pink",
  "fuchsia",
  "violet",
  "indigo",
  "sky",
  "cyan",
  "teal",
  "emerald",
  "lime",
] as const;
export type TopicTone = (typeof TOPIC_TONES)[number];

const ICON_TONES: Record<Exclude<MajordomeTopicIcon, "hash">, TopicTone> = {
  dumbbell: "orange",
  footprints: "lime",
  wallet: "emerald",
  receipt: "teal",
  bitcoin: "amber",
  plane: "sky",
  "heart-pulse": "rose",
  "book-open": "indigo",
  languages: "violet",
  briefcase: "cyan",
  home: "pink",
  utensils: "orange",
  music: "fuchsia",
  code: "indigo",
  "pen-line": "violet",
  users: "pink",
  leaf: "emerald",
  car: "sky",
  lightbulb: "amber",
};

/** The topic's colour: its icon's, or one its title always maps to when the icon is plain `hash`. */
export function topicTone(topic: Parameters<typeof topicIcon>[0]): TopicTone {
  const icon = topicIcon(topic);
  if (icon !== "hash") return ICON_TONES[icon];
  let hash = 0;
  for (const char of topic.title) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return TOPIC_TONES[hash % TOPIC_TONES.length] ?? "amber";
}
