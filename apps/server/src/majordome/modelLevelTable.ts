/** The table of level defaults this server uses, kept current from Majordome's repository. */

import { ModelLevelTable } from "@t3tools/contracts";
import {
  BUNDLED_MODEL_LEVEL_TABLE,
  newerModelLevelTable,
} from "@t3tools/shared/majordomeModelLevels";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

const MODEL_LEVEL_TABLE_URL =
  "https://raw.githubusercontent.com/Wozacosta/majordome/main/packages/shared/src/majordome-model-levels.json";

const REFRESH_INTERVAL = "1 hour";
const FETCH_TIMEOUT = "10 seconds";

const decodeTable = Schema.decodeUnknownEffect(ModelLevelTable);

// One table per process, read by resolvers that are plain functions; only `refresh` writes it.
let current: ModelLevelTable = BUNDLED_MODEL_LEVEL_TABLE;

export const currentModelLevelTable = (): ModelLevelTable => current;

/**
 * Downloads the table and keeps it when it is well formed and newer than the one in hand. Any
 * failure leaves the table as it was: a server that is offline runs on the one it shipped with.
 */
export const refreshModelLevelTable = Effect.fn("majordome.refreshModelLevelTable")(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const allowed = yield* settings.getSettings.pipe(
    Effect.map((value) => value.enableProviderUpdateChecks),
    Effect.orElseSucceed(() => true),
  );
  if (!allowed) return current;
  const httpClient = yield* HttpClient.HttpClient;
  const fetched = yield* httpClient.get(MODEL_LEVEL_TABLE_URL).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.flatMap(decodeTable),
    Effect.timeout(FETCH_TIMEOUT),
    Effect.catchCause(() => Effect.succeed(null)),
  );
  if (fetched !== null) current = newerModelLevelTable(current, fetched);
  return current;
});

export const layerRefresh = Layer.effectDiscard(
  forkParked(refreshModelLevelTable().pipe(Effect.repeat(Schedule.spaced(REFRESH_INTERVAL)))),
);
