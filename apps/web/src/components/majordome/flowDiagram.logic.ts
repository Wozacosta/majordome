export const FLOW_NODE_HEIGHT = 56;
export const FLOW_NODE_GAP = 12;

/**
 * Where each column starts, top to bottom, with the shorter columns centred on the longest, and
 * the middle of any node in it.
 */
export function flowLayout(counts: ReadonlyArray<number>): {
  readonly height: number;
  readonly offsets: ReadonlyArray<number>;
  readonly middleOf: (column: number, index: number) => number;
} {
  const columnHeight = (count: number) =>
    count === 0 ? 0 : count * FLOW_NODE_HEIGHT + (count - 1) * FLOW_NODE_GAP;
  const height = Math.max(0, ...counts.map(columnHeight));
  const offsets = counts.map((count) => (height - columnHeight(count)) / 2);
  return {
    height,
    offsets,
    middleOf: (column, index) =>
      (offsets[column] ?? 0) + index * (FLOW_NODE_HEIGHT + FLOW_NODE_GAP) + FLOW_NODE_HEIGHT / 2,
  };
}
