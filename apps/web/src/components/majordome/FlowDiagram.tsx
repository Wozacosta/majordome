import { Link } from "@tanstack/react-router";
import { type ComponentType, Fragment } from "react";

import { cn } from "../../lib/utils";
import type { SettingsPath } from "../settings/settingsSearch";
import { Badge } from "../ui/badge";
import { FLOW_NODE_GAP, FLOW_NODE_HEIGHT, flowLayout } from "./flowDiagram.logic";

export interface FlowNode {
  readonly id: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly title: string;
  readonly detail?: string | null;
  /** A word on the node, such as "Main". */
  readonly badge?: string;
  /** Not there yet, or out of reach: drawn faint. */
  readonly faint?: boolean;
  /** The settings page where this is set up; the box then opens it. */
  readonly to?: SettingsPath;
}

export interface FlowLine {
  readonly from: string;
  readonly to: string;
  /** False draws it dashed and grey: the two are not talking right now. */
  readonly live?: boolean;
}

/**
 * Boxes in columns with a line for what reaches what, left to right. `summary` says the same to
 * a screen reader. A box may open the page where it is set up; the rest of the actions sit
 * beside the drawing.
 */
export function FlowDiagram({
  columns,
  lines,
  summary,
  className,
}: {
  readonly columns: ReadonlyArray<ReadonlyArray<FlowNode>>;
  /** Each joins a node to one in the next column. */
  readonly lines: ReadonlyArray<FlowLine>;
  readonly summary: string;
  readonly className?: string;
}) {
  const layout = flowLayout(columns.map((column) => column.length));
  const place = (id: string) => {
    for (const [column, nodes] of columns.entries()) {
      const index = nodes.findIndex((node) => node.id === id);
      if (index >= 0) return { column, middle: layout.middleOf(column, index) };
    }
    return null;
  };
  return (
    <div
      // A drawing, unless a box in it is a link, which an image cannot hold.
      role={columns.some((nodes) => nodes.some((node) => node.to)) ? "group" : "img"}
      aria-label={summary}
      // Below this width the columns would be too narrow to read.
      className={cn("hidden sm:grid", className)}
      style={{
        height: layout.height,
        gridTemplateColumns: columns
          .map((_, index) => (index === 0 ? "minmax(0,6fr)" : "minmax(1.5rem,1fr) minmax(0,6fr)"))
          .join(" "),
      }}
    >
      {columns.map((nodes, column) => (
        // oxlint-disable-next-line react/no-array-index-key -- a column has no identity but its place
        <Fragment key={column}>
          {column === 0 ? null : (
            <svg
              aria-hidden
              viewBox={`0 0 100 ${layout.height}`}
              preserveAspectRatio="none"
              className="size-full"
            >
              {lines.map((line) => {
                const from = place(line.from);
                const to = place(line.to);
                if (from === null || to === null || to.column !== column) return null;
                return (
                  <path
                    key={`${line.from}:${line.to}`}
                    d={`M 0 ${from.middle} C 50 ${from.middle}, 50 ${to.middle}, 100 ${to.middle}`}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1.5}
                    strokeDasharray={line.live === false ? "4 4" : undefined}
                    className={
                      line.live === false ? "stroke-muted-foreground/50" : "stroke-success"
                    }
                  />
                );
              })}
            </svg>
          )}
          <div
            className="flex min-w-0 flex-col"
            style={{ paddingTop: layout.offsets[column], gap: FLOW_NODE_GAP }}
          >
            {nodes.map((node) => {
              const className = cn(
                "flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg border bg-card px-3",
                node.badge ? "border-primary/60" : "border-border",
                node.faint && "border-dashed opacity-70",
              );
              const inside = (
                <>
                  <node.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    {/* A name wraps onto more lines before it is ever cut short. */}
                    <p className="line-clamp-3 text-sm leading-tight font-medium text-foreground">
                      {node.title}
                    </p>
                    {node.detail ? (
                      <p className="truncate text-xs text-muted-foreground">{node.detail}</p>
                    ) : null}
                  </div>
                  {node.badge ? <Badge size="sm">{node.badge}</Badge> : null}
                </>
              );
              return node.to ? (
                <Link
                  key={node.id}
                  to={node.to}
                  style={{ height: FLOW_NODE_HEIGHT }}
                  className={cn(
                    className,
                    "outline-none hover:border-primary/60 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                >
                  {inside}
                </Link>
              ) : (
                <div key={node.id} style={{ height: FLOW_NODE_HEIGHT }} className={className}>
                  {inside}
                </div>
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
