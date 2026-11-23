export interface OutlineHeading {
  readonly label: string;
  /**
   * A "title" names the places after it, such as one computer. A "section" stands on its own, and
   * a "nested" place belongs to whatever came before it.
   */
  readonly kind: "title" | "section" | "nested";
}

export interface OutlineItem {
  readonly label: string;
  /** Its place among the page's headings, which is how the page finds it again. */
  readonly index: number;
}

export interface OutlineGroup {
  readonly title: OutlineItem | null;
  readonly sections: readonly OutlineItem[];
}

/** A page with fewer places than this is read in one look. */
const FEWEST_WORTH_LISTING = 3;

/** The page's headings as the lines of its outline: one line per title, or one line in all. */
export function outlineGroups(headings: readonly OutlineHeading[]): readonly OutlineGroup[] {
  if (headings.length < FEWEST_WORTH_LISTING) return [];
  const groups: { title: OutlineItem | null; sections: OutlineItem[] }[] = [];
  headings.forEach((heading, index) => {
    const item = { label: heading.label, index };
    if (heading.kind === "title") {
      groups.push({ title: item, sections: [] });
      return;
    }
    const last = groups.at(-1);
    if (last && (heading.kind === "nested" || last.title === null)) last.sections.push(item);
    else groups.push({ title: null, sections: [item] });
  });
  return groups;
}

/** The heading the reader is under: the last one at or above the line, the first before any. */
export function currentHeading(tops: readonly number[], line: number, atEnd: boolean): number {
  if (tops.length === 0) return -1;
  if (atEnd) return tops.length - 1;
  let current = 0;
  tops.forEach((top, index) => {
    if (top <= line) current = index;
  });
  return current;
}
