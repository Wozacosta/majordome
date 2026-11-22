import {
  type MajordomeReadingItem,
  type MajordomeReadingListError,
  OrchestratorMcpFailure,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MajordomeReadingList from "../../../majordome/MajordomeReadingList.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { LIST_READING_DEFAULT_LIMIT, ReadingListToolkit } from "./tools.ts";

/** What the agent reads when there is no list to give. Model-facing. */
export const READING_LIST_NOTES = {
  not_a_vault: "This thread does not work in a notes folder, so there is no reading list here.",
} as const;

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message });

const toFailure = (error: MajordomeReadingListError) => failure(error.message);

/** The project whose reading list the calling thread works on. */
const callerProject = Effect.fn("ReadingListHandlers.callerProject")(function* (tool: string) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, tool);
  const shell = yield* (yield* ThreadManagementService.ThreadManagementService)
    .getThreadShell(thread.threadId)
    .pipe(Effect.mapError((error) => failure(error.message)));
  if (shell === null) {
    return yield* new OrchestratorMcpFailure({
      code: "thread_not_found",
      message: "The calling thread was not found.",
    });
  }
  return shell.projectId;
});

const present = (item: MajordomeReadingItem) => ({
  id: item.id,
  title: item.title,
  ...(item.url === null ? {} : { url: item.url }),
  kind: item.kind,
  ...(item.site === undefined ? {} : { site: item.site }),
  ...(item.tags.length === 0 ? {} : { tags: item.tags }),
  ...(item.minutes === undefined ? {} : { minutes: item.minutes }),
  ...(item.summary === undefined ? {} : { summary: item.summary }),
  ...(item.why === undefined ? {} : { why: item.why }),
  ...(item.notes === undefined ? {} : { notes: item.notes }),
  ...(item.progress === undefined ? {} : { progress: item.progress }),
  ...(item.starred === true ? { starred: true } : {}),
  ...(item.doneAt === undefined ? {} : { doneAt: item.doneAt }),
  ...(item.snoozedUntil === undefined ? {} : { snoozedUntil: item.snoozedUntil }),
  ...(item.subjectId === undefined ? {} : { subjectId: item.subjectId }),
});

const holdsEveryWord = (item: MajordomeReadingItem, query: string) => {
  const text = [item.title, item.site, item.url, item.summary, item.notes, item.why, ...item.tags]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
};

const itemsOf = (projectId: ProjectId) =>
  MajordomeReadingList.MajordomeReadingList.pipe(
    Effect.flatMap((list) => list.list({ projectId })),
    Effect.mapError(toFailure),
  );

const handlers = {
  list_reading: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { isVault, items, subjects } = yield* itemsOf(yield* callerProject("list_reading"));
      if (!isVault) return { items: [], note: READING_LIST_NOTES.not_a_vault };
      const status = input.status ?? "unread";
      const matching = items.filter(
        (item) =>
          (status === "trash"
            ? item.deletedAt !== undefined
            : item.deletedAt === undefined &&
              (item.doneAt !== undefined) === (status === "done")) &&
          (input.subjectId === undefined || item.subjectId === input.subjectId) &&
          (input.query === undefined || holdsEveryWord(item, input.query)),
      );
      const limit = input.limit ?? LIST_READING_DEFAULT_LIMIT;
      return {
        items: matching.slice(0, limit).map(present),
        ...(subjects === undefined || subjects.length === 0
          ? {}
          : {
              subjects: subjects.map(({ id, name, focus }) => ({
                id,
                name,
                ...(focus === true ? { focus } : {}),
              })),
            }),
        ...(matching.length > limit ? { total: matching.length } : {}),
      };
    }),
  ),
  add_reading: McpToolAccess.actsAsCaller(({ text, ...fields }) =>
    Effect.gen(function* () {
      const projectId = yield* callerProject("add_reading");
      const list = yield* MajordomeReadingList.MajordomeReadingList;
      const added = yield* list
        .add({ projectId, text }, { mustLoad: true })
        .pipe(Effect.mapError(toFailure));
      if (added.duplicate || Object.keys(fields).length === 0) {
        return { item: present(added.item), duplicate: added.duplicate };
      }
      const item = yield* list
        .update({ projectId, itemId: added.item.id, ...fields })
        .pipe(Effect.mapError(toFailure));
      return { item: present(item), duplicate: false };
    }),
  ),
  update_reading: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const projectId = yield* callerProject("update_reading");
      const list = yield* MajordomeReadingList.MajordomeReadingList;
      const before = (yield* itemsOf(projectId)).items;
      const updates = input.updates ?? [];
      const unknown = updates.find(({ id }) => !before.some((item) => item.id === id));
      // Checked for all before any is changed, so a wrong id never leaves half of them done.
      if (unknown !== undefined) {
        return yield* failure(
          `No item ${unknown.id} on the reading list: take ids from list_reading.`,
        );
      }
      for (const { id, trashed, ...fields } of updates) {
        const trashedNow = before.some((item) => item.id === id && item.deletedAt !== undefined);
        const ref = { projectId, itemId: id };
        if (Object.keys(fields).length > 0) {
          yield* list.update({ ...ref, ...fields }).pipe(Effect.mapError(toFailure));
        }
        // Never `remove` on one already in the Trash: that would delete it for good.
        if (trashed === true && !trashedNow) {
          yield* list.remove(ref).pipe(Effect.mapError(toFailure));
        }
        if (trashed === false && trashedNow) {
          yield* list.restore(ref).pipe(Effect.mapError(toFailure));
        }
      }
      if (input.order !== undefined && input.order.length > 0) {
        yield* list.reorder({ projectId, itemIds: input.order }).pipe(Effect.mapError(toFailure));
      }
      const after = (yield* itemsOf(projectId)).items;
      return {
        items: after.filter((item) => updates.some(({ id }) => id === item.id)).map(present),
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ReadingListToolkit.tools>;

export const layer = McpToolAccess.toLayer(ReadingListToolkit, handlers);
