import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { CircleAlertIcon, CircleCheckIcon, CircleDotIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useQuietThreadShells } from "../../state/entities";
import { vaultHistoriesAtom } from "../../state/majordome";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stoppedRunKeys } from "./feed.logic";
import {
  capInFlight,
  type InFlight,
  type InFlightMark,
  inFlightPlaces,
  type InFlightRow,
  selectInFlight,
} from "./inFlight.logic";
import { routineThreadKeys } from "./routines.logic";
import type { MajordomeVault } from "./topics.logic";
import { useVaultRoutines } from "./useVaultRoutines";

/**
 * The notes folder's chats that are going on, on every server that has it, read from what the
 * chat lists already hold: nothing here asks a server anything.
 */
function useInFlight(vault: MajordomeVault): InFlight {
  const threads = useQuietThreadShells();
  const { routines } = useVaultRoutines(vault);
  const histories = useAtomValue(
    vaultHistoriesAtom(
      JSON.stringify(vault.copies.map((copy) => [copy.environmentId, copy.projectId])),
    ),
  );
  return selectInFlight({
    threads,
    vaults: vault.copies.map((copy) => ({
      environmentId: copy.environmentId,
      projectId: copy.projectId,
      title: vault.title,
    })),
    stoppedRuns: stoppedRunKeys(
      vault.copies.map((copy, index) => {
        const result = histories[index];
        const history = result === undefined ? null : AsyncResult.getOrElse(result, () => null);
        return { environmentId: copy.environmentId, stoppedRuns: history?.stoppedRuns ?? [] };
      }),
    ),
    places: inFlightPlaces(vault, routineThreadKeys(routines, threads)),
  });
}

function Mark({ mark }: { readonly mark: InFlightMark }) {
  switch (mark) {
    case "working":
      return <Spinner aria-hidden size="sm" tone="muted" className="shrink-0" />;
    case "answered":
      return <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-success-foreground" />;
    case "failed":
      return (
        <CircleAlertIcon aria-hidden className="size-3.5 shrink-0 text-destructive-foreground" />
      );
    case "asking":
      return <CircleDotIcon aria-hidden className="size-3.5 shrink-0 text-warning-foreground" />;
  }
}

function Group({
  id,
  title,
  rows,
}: {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<InFlightRow>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;
  const { shown, more } = capInFlight(rows, expanded);
  return (
    <section aria-label={title} data-in-flight={id}>
      <h2 className="flex items-baseline gap-1.5 text-xs font-medium text-muted-foreground">
        {title}
        <span className="tabular-nums opacity-70">{rows.length}</span>
      </h2>
      <ul className="m-0 mt-0.5 list-none p-0">
        {shown.map((row) => (
          <li key={row.key} data-in-flight-row={row.mark}>
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(row.environmentId, row.threadId))}
              className="-mx-2 flex min-h-8 items-center gap-2.5 rounded-md px-2 py-1 outline-hidden hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Mark mark={row.mark} />
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="min-w-0 truncate text-sm text-foreground">{row.title}</span>
                {row.place === null ? null : (
                  <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground max-sm:hidden">
                    {row.place}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 text-xs",
                  row.mark === "working" ? "text-muted-foreground" : "font-medium text-foreground",
                )}
              >
                {row.state}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 || expanded ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="-ms-2"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `+${more} more`}
        </Button>
      ) : null}
    </section>
  );
}

/** What needs the owner and what the assistant is doing; nothing at all while nothing is going on. */
export function InFlightGroups({ inFlight }: { readonly inFlight: InFlight }) {
  if (inFlight.needsYou.length === 0 && inFlight.working.length === 0) return null;
  return (
    <div className="mt-5 flex flex-col gap-3" data-in-flight-block>
      <Group id="needs-you" title="Needs you" rows={inFlight.needsYou} />
      <Group id="working" title="Working" rows={inFlight.working} />
    </div>
  );
}

export function TodayInFlight({ vault }: { readonly vault: MajordomeVault }) {
  return <InFlightGroups inFlight={useInFlight(vault)} />;
}
