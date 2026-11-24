import { hidesCodingTools } from "@t3tools/shared/majordome";

/**
 * What a Claude session is not given in Majordome, to make every first request smaller. Measured
 * on a first request of about 44,000 tokens: the publishing tools are 12,000 of it, and the
 * owner's personal Claude Code setup (plugins, skills, hooks) another 10,000.
 */
export const claudeSessionCuts: {
  /** Claude's tools for publishing pages on claude.ai, which a notes assistant never uses. */
  readonly disallowedTools?: ReadonlyArray<string>;
  /** Without "user": the notes folder's own skills and settings, not the owner's coding setup. */
  readonly settingSources?: ReadonlyArray<"project" | "local">;
} = hidesCodingTools
  ? {
      disallowedTools: [
        "Artifact",
        "ArtifactComments",
        "ArtifactData",
        "ArtifactCheck",
        "mcp__claude-artifacts",
      ],
      settingSources: ["project", "local"],
    }
  : {};

/**
 * A routine starts a session, works for a few minutes and is rarely answered, so what it writes
 * to the cache is kept five minutes, which costs 1.25 times the input price and not twice.
 */
export function routineQueryEnvironment(
  environment: NodeJS.ProcessEnv,
  startedByRoutine: boolean,
): NodeJS.ProcessEnv {
  return startedByRoutine && environment.CLAUDE_CODE_PROMPT_CACHE_TTL === undefined
    ? { ...environment, CLAUDE_CODE_PROMPT_CACHE_TTL: "5m" }
    : environment;
}
