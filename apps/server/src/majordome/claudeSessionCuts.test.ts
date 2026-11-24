import { assert, it } from "@effect/vitest";

import { routineQueryEnvironment } from "./claudeSessionCuts.ts";

it("keeps a routine's cache five minutes unless the owner set a time", () => {
  const env = { PATH: "/bin" };
  assert.equal(routineQueryEnvironment(env, true).CLAUDE_CODE_PROMPT_CACHE_TTL, "5m");
  assert.strictEqual(routineQueryEnvironment(env, false), env);
  const chosen = { ...env, CLAUDE_CODE_PROMPT_CACHE_TTL: "1h" };
  assert.strictEqual(routineQueryEnvironment(chosen, true), chosen);
});
