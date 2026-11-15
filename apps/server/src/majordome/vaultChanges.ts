/**
 * When a vault's notes change on disk, whoever changed them (an agent run, Obsidian, an undo, a
 * sync), so open Notes screens read the tree and the note again. One signal per quiet moment,
 * never one per write.
 */

import * as Clock from "effect/Clock";
import type * as Duration from "effect/Duration";
import type * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";

export const VAULT_CHANGES_QUIET_PERIOD = "1 second";

/** `.git`, `.majordome`, `.obsidian` and other plumbing that Notes never shows. */
const isPlumbing = (relativePath: string) =>
  relativePath
    .split(/[\\/]/)
    .some((segment) => segment.startsWith(".") || segment === "node_modules");

/**
 * The time, in milliseconds, of each burst of note changes once `quietPeriod` passes without one:
 * a revision that never repeats, even for a client that subscribes again after a reconnect.
 */
export const vaultChangeRevisions = <E, R>(
  events: Stream.Stream<FileSystem.WatchEvent, E, R>,
  quietPeriod: Duration.Input,
): Stream.Stream<number, E, R> =>
  events.pipe(
    Stream.filter((event) => !isPlumbing(event.path)),
    Stream.debounce(quietPeriod),
    Stream.mapEffect(() => Clock.currentTimeMillis),
  );
