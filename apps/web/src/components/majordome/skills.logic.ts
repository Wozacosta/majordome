import type {
  MajordomeSkill,
  MajordomeSkillSource,
  MajordomeSkillsResult,
} from "@t3tools/contracts";

const SKILL_PATH = /^\.(?:agents\/(?:proposed-)?skills|claude\/skills)\/([^/]+)\//;

/** A skill's folder name as a person reads it: `file-receipts` is "File receipts". */
export function skillTitle(name: string): string {
  const words = name.replaceAll(/[_-]+/g, " ").trim();
  return words === "" ? name : words[0]!.toUpperCase() + words.slice(1);
}

/** The skill a changed file belongs to, or null for any other file. */
export const skillOfPath = (path: string): string | null => SKILL_PATH.exec(path)?.[1] ?? null;

/** In the order the page lists them: what needs a decision first. */
const SKILL_STATES = ["waiting", "inUse", "off"] as const;
export type SkillState = (typeof SKILL_STATES)[number];

export const SKILL_STATE_LABELS: Record<SkillState, string> = {
  waiting: "Waiting for your yes",
  inUse: "In use",
  off: "Off",
};

export const SKILL_SOURCE_LABELS: Record<MajordomeSkillSource, string> = {
  assistant: "By your assistant",
  majordome: "From Majordome",
  other: "Other",
};

export type SkillRow = MajordomeSkill & {
  /** A name can be listed twice: in use, and a new version of it waiting. */
  readonly key: string;
  readonly title: string;
  readonly state: SkillState;
  /** True for a waiting skill that takes the place of one in use when kept. */
  readonly replaces: boolean;
  /** Its file in the notes folder. */
  readonly path: string;
};

/** Every skill of a notes folder as one list, by name. */
export function skillRows(result: Pick<MajordomeSkillsResult, "proposed" | "skills">) {
  const rows: Array<SkillRow> = [
    ...result.proposed.map(({ stopped, ...skill }) => ({
      ...skill,
      key: `waiting:${skill.name}`,
      title: skillTitle(skill.name),
      state: stopped ? ("off" as const) : ("waiting" as const),
      path: `.agents/proposed-skills/${skill.name}/SKILL.md`,
    })),
    ...result.skills.map((skill) => ({
      ...skill,
      key: `in-use:${skill.name}`,
      title: skillTitle(skill.name),
      state: "inUse" as const,
      replaces: false,
      path: `.agents/skills/${skill.name}/SKILL.md`,
    })),
  ];
  return rows.toSorted((left, right) => left.title.localeCompare(right.title));
}

export type SkillSourceFilter = MajordomeSkillSource | "all";

const SOURCE_ORDER: ReadonlyArray<MajordomeSkillSource> = ["assistant", "majordome", "other"];

/**
 * What the page shows for a search and a source: the skills by state, the sources to choose from
 * with how many skills the search leaves in each, and how many waiting skills are filtered out.
 */
export function skillsView(
  rows: ReadonlyArray<SkillRow>,
  filter: { readonly query: string; readonly source: SkillSourceFilter },
) {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = rows.filter((row) => {
    const words = `${row.title} ${row.name} ${row.description}`.toLowerCase();
    return terms.every((term) => words.includes(term));
  });
  const sources = SOURCE_ORDER.filter((source) => rows.some((row) => row.source === source));
  // A source that is gone (its last skill deleted) leaves nothing selected, so all show.
  const source = filter.source !== "all" && sources.includes(filter.source) ? filter.source : "all";
  const shown = source === "all" ? found : found.filter((row) => row.source === source);
  return {
    source,
    /** Empty when every skill comes from the same place: nothing to choose between. */
    tabs:
      sources.length < 2
        ? []
        : [
            { source: "all" as const, count: found.length },
            ...sources.map((candidate) => ({
              source: candidate,
              count: found.filter((row) => row.source === candidate).length,
            })),
          ],
    groups: SKILL_STATES.flatMap((state) => {
      const inState = shown.filter((row) => row.state === state);
      return inState.length === 0 ? [] : [{ state, rows: inState }];
    }),
    hiddenWaiting:
      rows.filter((row) => row.state === "waiting").length -
      shown.filter((row) => row.state === "waiting").length,
  };
}
