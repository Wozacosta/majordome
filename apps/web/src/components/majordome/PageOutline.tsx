import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import {
  currentHeading,
  type OutlineHeading,
  type OutlineItem,
  outlineGroups,
} from "./pageOutline.logic";

/** What a page's outline lists: paper's own headings and the section headings of a T3 page. */
const HEADING_SELECTOR =
  '[data-page-outline], [data-slot="settings-section-heading"] h2, [data-slot="settings-fold-heading"] h2';
const SCROLL_SELECTOR = "[data-settings-page-scroll]";
/** How far under the outline a heading sits once jumped to, and counts as the one being read. */
const HEADING_GAP = 16;

function pageHeadings(scroll: HTMLElement): HTMLElement[] {
  return [...scroll.querySelectorAll<HTMLElement>(HEADING_SELECTOR)].filter(
    (heading) => heading.checkVisibility() && heading.textContent.trim() !== "",
  );
}

function describeHeading(heading: HTMLElement): OutlineHeading {
  const marked = heading.dataset.pageOutline;
  return {
    label: heading.textContent.trim(),
    kind:
      marked === "title"
        ? "title"
        : marked === "entry" || heading.tagName === "H3"
          ? "nested"
          : "section",
  };
}

function sameHeadings(a: readonly OutlineHeading[], b: readonly OutlineHeading[]): boolean {
  return (
    a.length === b.length &&
    a.every((heading, index) => heading.label === b[index]?.label && heading.kind === b[index].kind)
  );
}

/**
 * The places on a long settings page, under its title and kept in view while the page scrolls.
 * It reads them from the page's headings, so a page lists whatever it is showing right now.
 */
export function PageOutline({ className }: { readonly className?: string }) {
  const navRef = useRef<HTMLElement>(null);
  const [headings, setHeadings] = useState<readonly OutlineHeading[]>([]);
  const [current, setCurrent] = useState(-1);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the outline mirrors the headings in the page's DOM, which other components render and change as their data loads
  useEffect(() => {
    const nav = navRef.current;
    const scroll = nav?.closest<HTMLElement>(SCROLL_SELECTOR);
    if (!nav || !scroll) return;
    const readPosition = () => {
      const line = nav.getBoundingClientRect().bottom + HEADING_GAP + 1;
      const atEnd = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1;
      const tops = pageHeadings(scroll).map((heading) => heading.getBoundingClientRect().top);
      setCurrent(currentHeading(tops, line, atEnd && scroll.scrollTop > 0));
    };
    const readHeadings = () => {
      const next = pageHeadings(scroll).map(describeHeading);
      setHeadings((previous) => (sameHeadings(previous, next) ? previous : next));
      readPosition();
    };
    readHeadings();
    const observer = new MutationObserver(readHeadings);
    observer.observe(scroll, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "data-open", "hidden"],
    });
    scroll.addEventListener("scroll", readPosition, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", readPosition);
    };
  }, []);

  const jumpTo = (index: number) => {
    const nav = navRef.current;
    const scroll = nav?.closest<HTMLElement>(SCROLL_SELECTOR);
    if (!nav || !scroll) return;
    const heading = pageHeadings(scroll)[index];
    if (!heading) return;
    const stuckBottom = scroll.getBoundingClientRect().top + nav.offsetHeight;
    scroll.scrollTo({
      top: scroll.scrollTop + heading.getBoundingClientRect().top - stuckBottom - HEADING_GAP,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const groups = outlineGroups(headings);
  const link = (item: OutlineItem, isTitle: boolean) => (
    <button
      key={item.index}
      type="button"
      // Named apart from the page's own controls, which often carry a section's exact words.
      aria-label={`Go to ${item.label}`}
      aria-current={item.index === current ? "location" : undefined}
      onClick={() => jumpTo(item.index)}
      className={cn(
        "rounded-md px-2 py-1 text-xs outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-foreground",
        isTitle ? "font-semibold text-foreground" : "text-muted-foreground",
      )}
    >
      {item.label}
    </button>
  );

  return (
    <nav
      ref={navRef}
      aria-label="On this page"
      data-page-outline-nav
      className={cn(
        "sticky top-0 z-10 -mx-2 flex flex-col gap-0.5 border-b border-border bg-background py-1.5",
        groups.length === 0 && "hidden",
        className,
      )}
    >
      {groups.map((group) => (
        <div
          key={group.title?.index ?? group.sections[0]?.index}
          className="flex flex-wrap items-center gap-x-0.5"
        >
          {group.title ? link(group.title, true) : null}
          {group.sections.map((item) => link(item, false))}
        </div>
      ))}
    </nav>
  );
}
