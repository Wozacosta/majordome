import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { OVERVIEW_TONE_DOT_CLASS, type OverviewTone } from "./overview.logic";

/**
 * Majordome's notebook look: clear headings, hairline entries, and few raised surfaces. Its pages
 * compose these slots, so the recipes live here.
 */

type PaperTone = OverviewTone;

/** The comfortable line length for text that is read, not scanned. */
export const READING_MEASURE_CLASS = "max-w-[46rem]";

/** Heading type, for a heading that sits outside the slots here. */
export const HEADING_CLASS = "font-semibold tracking-tight text-foreground";

/** On a link or button that is a whole row: the hover and focus look, with its text kept aligned. */
export const ROW_ACTION_CLASS =
  "-mx-2 rounded-md px-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function PageTitle({ className, ...props }: ComponentPropsWithoutRef<"h1">) {
  return <h1 className={cn(HEADING_CLASS, "text-3xl", className)} {...props} />;
}

/** A page's start: its title, one sentence that helps a decision, and the page's own action. */
export function PageHeader({
  title,
  intro,
  action,
}: {
  readonly title: ReactNode;
  readonly intro?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
        <PageTitle>{title}</PageTitle>
        {intro ? <Muted className={READING_MEASURE_CLASS}>{intro}</Muted> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 pt-1.5">{action}</div> : null}
    </header>
  );
}

/** A machine's or a brain's name over its own sections. */
export function SectionTitle({ className, ...props }: ComponentPropsWithoutRef<"h2">) {
  return (
    <h2 data-page-outline="title" className={cn(HEADING_CLASS, "text-xl", className)} {...props} />
  );
}

export function SectionLabel({
  as: Heading = "h2",
  className,
  ...props
}: ComponentPropsWithoutRef<"h2"> & { readonly as?: "h2" | "h3" }) {
  return (
    <Heading
      data-page-outline="section"
      className={cn(
        "min-w-0 flex-1 text-2xs font-semibold tracking-widest text-primary uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled part of a page. Without a label it only keeps the spacing between parts. */
export function Section({
  label,
  labelAs,
  action,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"section"> & {
  readonly label?: ReactNode;
  /** "h3" under a `SectionTitle`. */
  readonly labelAs?: "h2" | "h3";
  /** A link or small control beside the label. */
  readonly action?: ReactNode;
}) {
  return (
    <section className={cn("mt-8", className)} {...props}>
      {label ? (
        <div className="mb-2 flex items-baseline gap-3">
          <SectionLabel {...(labelAs ? { as: labelAs } : {})}>{label}</SectionLabel>
          {action ? <span className="shrink-0 text-xs text-muted-foreground">{action}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Muted({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function EntryList({ className, ...props }: ComponentPropsWithoutRef<"ul">) {
  return <ul className={cn("m-0 list-none p-0", className)} {...props} />;
}

export function EntryTitle({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("min-w-0 text-sm font-medium text-foreground", className)} {...props} />;
}

/**
 * One entry of a list, under a hairline: a title, a line about it, its controls on the
 * right, and whatever belongs to it below.
 */
export function Entry({
  as: Tag = "li",
  title,
  outlined = false,
  aside,
  meta,
  actions,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** "div" where the entries around it are not a list's items. */
  readonly as?: "li" | "div";
  readonly title?: ReactNode;
  /** A place worth a line in the page's outline, such as one of a few big options. */
  readonly outlined?: boolean;
  /** A badge or mark beside the title. */
  readonly aside?: ReactNode;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}) {
  const hasHeader = title !== undefined || meta !== undefined || actions !== undefined;
  return (
    <Tag className={cn("border-t border-border py-3", className)} {...props}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-40">
            {title !== undefined ? (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <EntryTitle data-page-outline={outlined ? "entry" : undefined}>{title}</EntryTitle>
                {aside}
              </div>
            ) : null}
            {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children ? (
        <div className={cn("flex flex-col gap-2 text-sm text-foreground", hasHeader && "mt-2")}>
          {children}
        </div>
      ) : null}
    </Tag>
  );
}

const TONE_LABEL: Record<PaperTone, string | undefined> = {
  ok: "Fine",
  neutral: undefined,
  warning: "Needs your attention",
  error: "Something failed",
};

export function ToneDot({
  tone,
  className,
}: {
  readonly tone: PaperTone;
  readonly className?: string;
}) {
  return (
    <span
      role={tone === "warning" || tone === "error" ? "img" : undefined}
      aria-label={TONE_LABEL[tone]}
      aria-hidden={tone === "neutral" ? true : undefined}
      className={cn("size-2 shrink-0 rounded-full", OVERVIEW_TONE_DOT_CLASS[tone], className)}
    />
  );
}

/** How something is doing, in one line: a dot for its state, then the words. */
export function StatusLine({
  tone,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"p"> & { readonly tone: PaperTone }) {
  return (
    <p
      className={cn("flex min-w-0 items-start gap-2 text-sm text-foreground", className)}
      data-tone={tone}
      {...props}
    >
      <ToneDot tone={tone} className="mt-1.5" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/** Stands in for a list while it loads, so an empty page is never read as "none". */
export function ListSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** A list that could not be read: what failed, and the way to ask again. */
export function LoadFailed({
  onRetry,
  className,
  children,
}: {
  readonly onRetry: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-3",
        className,
      )}
    >
      <StatusLine tone="error" className="flex-1 basis-48">
        {children}
      </StatusLine>
      <Button size="xs" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** A switch and its words, tall enough to tap on a phone. */
export function SwitchLabel({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return (
    <label
      className={cn(
        "flex min-h-10 min-w-0 items-center gap-2.5 text-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Setup steps, numbered in the margin. */
export function Steps({ className, ...props }: ComponentPropsWithoutRef<"ol">) {
  return <ol className={cn("m-0 list-none p-0 [counter-reset:step]", className)} {...props} />;
}

export function Step({
  title,
  className,
  children,
  ...props
}: Omit<ComponentPropsWithoutRef<"li">, "title"> & { readonly title?: ReactNode }) {
  return (
    <li
      className={cn(
        "relative border-t border-border py-3 ps-8 [counter-increment:step] before:absolute before:start-0 before:top-3 before:text-sm before:font-medium before:text-primary before:content-[counter(step)]",
        className,
      )}
      {...props}
    >
      {title ? <EntryTitle className="mb-1">{title}</EntryTitle> : null}
      {/* Not a flex column: a step's words and the links inside them stay one flowing line. */}
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </li>
  );
}

/** A raised sheet, for what is a separate object on the page: a form, a code to copy. */
export function Surface({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card p-4 shadow-xs", className)}
      {...props}
    />
  );
}

/** Explanation that is there when wanted and out of the way when not. */
export function Disclosure({
  summary,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"details"> & { readonly summary: ReactNode }) {
  return (
    <details className={cn("text-sm text-muted-foreground", className)} {...props}>
      <summary className="-mx-2 w-fit cursor-pointer rounded-md px-2 py-2.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        {summary}
      </summary>
      <div className="mt-1 flex flex-col gap-2 pb-1">{children}</div>
    </details>
  );
}
