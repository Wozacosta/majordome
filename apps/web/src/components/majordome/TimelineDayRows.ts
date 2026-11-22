import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import { isMajordome } from "~/env";
import { useQuietThreadShell } from "../../state/entities";
import { type MessagesTimelineRow, withTimelineDayRows } from "../chat/MessagesTimeline.logic";

interface TimelineDayRowsState {
  readonly identity: string | null;
  /** Undefined until the chat's shell has loaded, which on a cold start is after the first render. */
  readonly lastVisitedAt: string | null | undefined;
  readonly openedAt: number;
  readonly source: MessagesTimelineRow[] | null;
  readonly result: MessagesTimelineRow[];
}

/**
 * The timeline's rows with Majordome's day dividers and its "new since you were last here" marker.
 * The absence is read once per opened chat, before opening it counts as a visit, so the marker
 * stays where it is while the person reads and the assistant answers. The result keeps its identity
 * until the rows change, as the list compares its data by identity.
 */
export function useTimelineDayRows(
  rows: MessagesTimelineRow[],
  identity: string,
  /** False for a read-only view such as a guest's, which has no chat of its own to ask about. */
  ownChat: boolean,
): MessagesTimelineRow[] {
  const shell = useQuietThreadShell(isMajordome && ownChat ? parseScopedThreadKey(identity) : null);
  const [state, setState] = useState<TimelineDayRowsState>({
    identity: null,
    lastVisitedAt: undefined,
    openedAt: 0,
    source: null,
    result: [],
  });
  if (!isMajordome) return rows;
  const reopened = state.identity !== identity;
  const lastVisitedAt =
    reopened || state.lastVisitedAt === undefined
      ? shell === null
        ? undefined
        : (shell.lastVisitedAt ?? null)
      : state.lastVisitedAt;
  if (!reopened && state.source === rows && state.lastVisitedAt === lastVisitedAt) {
    return state.result;
  }
  // oxlint-disable-next-line react/purity -- Samples the clock only when the rows or the chat change, to name today and to date the opening.
  const now = Date.now();
  const openedAt = reopened ? now : state.openedAt;
  const result = withTimelineDayRows(rows, {
    now: new Date(now),
    away: lastVisitedAt ? { since: Date.parse(lastVisitedAt), until: openedAt } : null,
  });
  setState({ identity, lastVisitedAt, openedAt, source: rows, result });
  return result;
}
