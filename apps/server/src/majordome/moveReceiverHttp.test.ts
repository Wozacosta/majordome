import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as MajordomeMoveReceiver from "./MajordomeMoveReceiver.ts";
import { vaultBundleResponse } from "./moveReceiverHttp.ts";

it.layer(NodeServices.layer)("vaultBundleResponse", (it) => {
  it.effect("leaves no copy of the notes on disk once the bundle is sent, or refused", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const written: Array<string> = [];
      const receiver = (
        sendVault: (
          bundlePath: string,
        ) => Effect.Effect<void, MajordomeMoveReceiver.MoveReceiverError>,
      ) =>
        ({
          sendVault: (bundlePath: string) =>
            Effect.sync(() => written.push(bundlePath)).pipe(Effect.andThen(sendVault(bundlePath))),
        }) as unknown as MajordomeMoveReceiver.MajordomeMoveReceiver["Service"];

      const response = yield* vaultBundleResponse(
        receiver((bundlePath) => fs.writeFileString(bundlePath, "every note").pipe(Effect.orDie)),
      );
      assert.equal(response.headers["cache-control"], "no-store");
      assert.isTrue(yield* fs.exists(written[0]!));
      assert.equal(response.body._tag, "Stream");
      const sent =
        response.body._tag === "Stream"
          ? yield* response.body.stream.pipe(Stream.decodeText(), Stream.mkString, Effect.orDie)
          : "";
      assert.equal(sent, "every note");
      assert.isFalse(yield* fs.exists(path.dirname(written[0]!)));

      const refused = yield* vaultBundleResponse(
        receiver((bundlePath) =>
          fs
            .writeFileString(bundlePath, "half a bundle")
            .pipe(
              Effect.orDie,
              Effect.andThen(new MajordomeMoveReceiver.MoveReceiverError({ reason: "no-notes" })),
            ),
        ),
      );
      assert.equal(refused.status, 409);
      assert.isFalse(yield* fs.exists(path.dirname(written[1]!)));
    }),
  );
});
