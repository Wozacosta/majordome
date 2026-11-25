#!/usr/bin/env node
// Compares Majordome's table of level defaults with the models the makers currently offer, as
// listed in T3 Code's model manifest. Prints what a person should look at and exits 3 when there
// is something: a current model the table places at no level, or a level no current model fills.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { MODEL_LEVELS, unplacedModels } from "@t3tools/shared/majordomeModelLevels";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import table from "../packages/shared/src/majordome-model-levels.json" with { type: "json" };

const MANIFEST_URL =
  "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json";

const Manifest = Schema.Struct({
  providers: Schema.Record(
    Schema.String,
    Schema.Struct({
      models: Schema.Array(Schema.Struct({ slug: Schema.String, status: Schema.String })),
    }),
  ),
});

const drivers: Readonly<Record<string, (typeof table.drivers)[keyof typeof table.drivers]>> =
  table.drivers;

const check = Effect.gen(function* () {
  const manifest = yield* HttpClient.get(MANIFEST_URL).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Manifest)),
  );
  const findings: Array<string> = [];
  for (const [driver, { models }] of Object.entries(manifest.providers)) {
    const current = models.filter((model) => model.status === "current").map((model) => model.slug);
    for (const slug of unplacedModels(table, driver, current)) {
      findings.push(`- \`${driver}\`: \`${slug}\` is a current model at no level.`);
    }
    const row = drivers[driver];
    if (row === undefined) {
      findings.push(`- \`${driver}\` has no row in the table.`);
      continue;
    }
    for (const level of MODEL_LEVELS) {
      const filled = row[level].some((family) => current.some((slug) => slug.includes(family)));
      if (!filled && row[level].length > 0) {
        findings.push(
          `- \`${driver}\`: no current model fills ${level} (looked for ${row[level].join(", ")}).`,
        );
      }
    }
  }
  if (findings.length === 0) {
    return yield* Console.log("The table of level defaults matches the models on offer.");
  }
  yield* Console.log(
    [
      "The makers' model lists have moved away from Majordome's table of level defaults.",
      "",
      ...findings,
      "",
      "Edit `packages/shared/src/majordomeModelLevels.ts` and its copy `majordome-model-levels.json`",
      "(raise `updatedAt`), or add a family to `ignored` when it should be no level. Servers pick",
      "the change up within the hour of it reaching `main`. Cursor, Kiro and Grok Build are not in",
      "the manifest: check their pages, linked in `docs/decisions.md`, by hand.",
    ].join("\n"),
  );
  // 3 means "look at this"; a crash exits with 1, which the workflow tells apart.
  process.exitCode = 3;
});

NodeRuntime.runMain(check.pipe(Effect.provide(FetchHttpClient.layer)));
