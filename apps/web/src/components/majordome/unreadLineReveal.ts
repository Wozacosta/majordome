import type { LegendListRef } from "@legendapp/list/react";

import type { TimelineViewport } from "../chat/timelineViewport";
import { startTimelinePositionRestore } from "../chat/useTimelinePositionRestore";

/** The room left above the "New" line when the chat opens on it. */
const NEW_LINE_GAP_PX = 12;

/**
 * Opens a chat with its "New" line in sight. A chat opens at its end; when the unread part is
 * taller than the screen the line is above it, so the list moves the line to the top instead and
 * stops following the end, as it does for someone reading history. Returns the cancel.
 */
export function startUnreadLineReveal(input: {
  readonly list: LegendListRef;
  readonly viewport: TimelineViewport;
  readonly rowId: string;
}): () => void {
  const { list, viewport, rowId } = input;
  let stop = () => {};
  // The list measures its rows from layout effects; the next frame sees where the line landed.
  const frame = requestAnimationFrame(() => {
    const state = list.getState();
    const index = state.indexByKey(rowId);
    const node = list.getScrollableNode();
    if (index === undefined || !node) return;
    const row: HTMLElement | undefined = state.elementAtIndex(index);
    if (row) {
      const bounds = node.getBoundingClientRect();
      const line = row.getBoundingClientRect();
      if (line.top >= bounds.top && line.bottom <= bounds.bottom) return;
    }
    stop = startTimelinePositionRestore({
      list,
      viewport,
      listIdentityKey: rowId,
      listOpenedOn: null,
      rememberedPosition: {
        rowId,
        offsetWithinRow: -NEW_LINE_GAP_PX,
        scrollOffset: 0,
        atEnd: false,
      },
      citationPending: false,
      releaseForFind: false,
      onPositioned: () => {},
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    stop();
  };
}
