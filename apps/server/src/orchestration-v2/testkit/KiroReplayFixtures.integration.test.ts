import { describe } from "@effect/vitest";

import { KiroOrchestratorReplayHarness } from "../Adapters/KiroAdapterV2.testkit.ts";
import { itRunsReplayFixtures, runReplayFixture } from "./ProviderReplayFixtures.ts";
import { vi } from "vite-plus/test";

// The fixtures were recorded with upstream's pull request instructions, which Majordome leaves out.
vi.mock(import("@t3tools/shared/majordome"), async (importOriginal) => ({
  ...(await importOriginal()),
  hidesCodingTools: false,
}));

describe("Kiro replay fixtures", () => {
  itRunsReplayFixtures("kiro", (input) =>
    runReplayFixture({ ...input, harness: KiroOrchestratorReplayHarness }),
  );
});
