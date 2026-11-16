import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as MajordomeNotesSearch from "../../../majordome/MajordomeNotesSearch.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { NotesSearchToolkit, SEARCH_NOTES_DEFAULT_LIMIT } from "./tools.ts";

/** What the agent reads when a search has nothing, or not everything, to give. Model-facing. */
export const SEARCH_NOTES_NOTES = {
  not_a_vault: "This thread does not work in a notes folder, so there is nothing to search.",
  no_match: "No note holds all of these words. Try fewer words, or other words for the same thing.",
  building:
    "The notes are still being indexed, so results may be incomplete. Look with your file tools too.",
  error:
    "The notes search is not working right now. Look through the notes with your file tools instead.",
} as const;

const handlers = {
  search_notes: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "search_notes");
      const { results, status } = yield* (yield* MajordomeNotesSearch.MajordomeNotesSearch)
        .searchForThread({
          threadId: thread.threadId,
          query: input.query,
          folder: input.folder,
          limit: input.limit ?? SEARCH_NOTES_DEFAULT_LIMIT,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
      const note =
        status === null
          ? SEARCH_NOTES_NOTES.not_a_vault
          : status.state === "error"
            ? SEARCH_NOTES_NOTES.error
            : status.state === "building"
              ? SEARCH_NOTES_NOTES.building
              : results.length === 0
                ? SEARCH_NOTES_NOTES.no_match
                : undefined;
      return {
        results: results.map(({ path, title, heading, snippet }) => ({
          path,
          title,
          ...(heading === null || heading === title ? {} : { heading }),
          snippet,
        })),
        ...(note === undefined ? {} : { note }),
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof NotesSearchToolkit.tools>;

export const layer = McpToolAccess.toLayer(NotesSearchToolkit, handlers);
