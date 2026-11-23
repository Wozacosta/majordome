import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as MajordomeDailyNotes from "./MajordomeDailyNotes.ts";
import * as VaultLock from "./VaultLock.ts";

const projectId = ProjectId.make("vault-project");
const day = { projectId, date: "2026-11-19" };

const setUp = Effect.fn("test.setUp")(function* (config: string | null) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-daily-" });
  if (config !== null) {
    yield* fs.makeDirectory(path.join(vault, ".majordome"));
    yield* fs.writeFileString(path.join(vault, ".majordome/config.json"), config);
  }
  const service = yield* Effect.service(MajordomeDailyNotes.MajordomeDailyNotes).pipe(
    Effect.provide(
      MajordomeDailyNotes.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: () => Effect.succeedSome({ workspaceRoot: vault } as ProjectStore.ProjectRow),
          }),
        ),
      ),
    ),
  );
  return { service, read: (relative: string) => fs.readFileString(path.join(vault, relative)) };
});

it.layer(NodeServices.layer)("MajordomeDailyNotes", (it) => {
  it.effect("adds timed lines to a day's note in the vault's daily folder, creating it", () =>
    Effect.gen(function* () {
      const { service, read } = yield* setUp('{"folders":{"daily":"journal"}}');
      assert.deepEqual(yield* service.get(day), { path: "journal/2026-11-19.md", content: null });

      yield* service.add({ ...day, time: "09:05", text: " Call the bank\nbefore noon " });
      yield* service.save({ ...day, base: "- 09:05 Call the bank before noon\n", content: "Plan" });
      yield* service.add({ ...day, time: "10:00", text: "Done" });

      assert.strictEqual(yield* read("journal/2026-11-19.md"), "Plan\n- 10:00 Done\n");
    }),
  );

  it.effect("leaves a note alone when it changed since the editor loaded it", () =>
    Effect.gen(function* () {
      const { service, read } = yield* setUp("{}");
      yield* service.add({ ...day, time: "09:05", text: "From a routine" });

      const error = yield* service.save({ ...day, base: null, content: "Mine" }).pipe(Effect.flip);

      // The editor tells this refusal from a passing failure by its reason, not its words.
      assert.strictEqual(error.reason, "changed");
      assert.strictEqual(yield* read("daily/2026-11-19.md"), "- 09:05 From a routine\n");
    }),
  );

  it.effect("refuses a folder that is not a notes folder", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp(null);
      const error = yield* service.get(day).pipe(Effect.flip);
      assert.strictEqual(error.message, "That notes folder was not found.");
    }),
  );
});
