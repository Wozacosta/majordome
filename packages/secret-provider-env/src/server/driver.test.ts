import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { driver } from "./driver.ts";

const environment = (variables: NodeJS.ProcessEnv) =>
  Layer.mergeAll(
    NodeServices.layer,
    NodeCrypto.layer,
    Layer.succeed(HostProcess.Environment, variables),
  );

describe("Environment variable driver", () => {
  it.effect("reads each variable in order, keeping the value as it is", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({}, ["env://OPENAI_API_KEY", "env://MISSING", "env://PADDED"]),
        ["sk-live", undefined, " sk b "],
      );
    }).pipe(Effect.provide(environment({ OPENAI_API_KEY: "sk-live", PADDED: " sk b " }))),
  );

  it.effect("reads an empty, inherited or malformed name as undefined", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({}, [
          "env://EMPTY",
          "env://BLANK",
          "env://constructor",
          "env://__proto__",
          "env://A=B",
          "HOME",
        ]),
        [undefined, undefined, undefined, undefined, undefined, undefined],
      );
    }).pipe(Effect.provide(environment({ EMPTY: "", BLANK: "  ", HOME: "/home/me" }))),
  );
});
