import { BUNDLED_MODEL_LEVEL_TABLE } from "@t3tools/shared/majordomeModelLevels";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import { fakeHttp, type FakeReply } from "./fakeHttp.testkit.ts";
import { refreshModelLevelTable } from "./modelLevelTable.ts";

const refreshWith = (reply: FakeReply, enableProviderUpdateChecks = true) => {
  const http = fakeHttp(() => reply);
  return refreshModelLevelTable().pipe(
    Effect.map((table) => ({ table, requests: http.requests.length })),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http.client),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({ enableProviderUpdateChecks } as never),
        }),
      ),
    ),
  );
};

// The table is the process's own, so the steps run in order within one test.
it.effect("keeps the table it has unless a well-formed, newer one is downloaded", () =>
  Effect.gen(function* () {
    const newer = {
      ...BUNDLED_MODEL_LEVEL_TABLE,
      updatedAt: "2099-01-01",
      ignored: ["fable"],
    };
    assert.strictEqual(
      (yield* refreshWith({ status: 500 })).table,
      BUNDLED_MODEL_LEVEL_TABLE,
      "a failed download",
    );
    assert.strictEqual(
      (yield* refreshWith({ body: { updatedAt: "2099-01-01", drivers: "nope" } })).table,
      BUNDLED_MODEL_LEVEL_TABLE,
      "a malformed table",
    );
    assert.strictEqual(
      (yield* refreshWith({ body: { ...newer, updatedAt: "2020-01-01" } })).table,
      BUNDLED_MODEL_LEVEL_TABLE,
      "an older table",
    );
    const off = yield* refreshWith({ body: newer }, false);
    assert.deepStrictEqual(
      [off.table === BUNDLED_MODEL_LEVEL_TABLE, off.requests],
      [true, 0],
      "update checks turned off",
    );
    assert.deepStrictEqual((yield* refreshWith({ body: newer })).table, newer);
  }),
);
