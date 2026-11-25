import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as MajordomeSavedKeys from "./MajordomeSavedKeys.ts";

const setUp = Effect.gen(function* () {
  const context = yield* Layer.build(
    MajordomeSavedKeys.layer.pipe(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "majordome-saved-keys-" }),
      ),
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    ),
  );
  return {
    service: yield* Effect.service(MajordomeSavedKeys.MajordomeSavedKeys).pipe(
      Effect.provide(context),
    ),
    config: yield* Effect.service(ServerConfig.ServerConfig).pipe(Effect.provide(context)),
  };
});

it.layer(NodeServices.layer)("MajordomeSavedKeys", (it) => {
  it.effect("lists a saved key by name, hands its value over as a file, and forgets it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { service } = yield* setUp;
      assert.deepEqual(yield* service.list(), { keys: [] });

      yield* service.save({ name: "garmin", note: "Garmin Connect token", value: "s3cret" });
      const [key] = (yield* service.list()).keys;
      assert.deepInclude(key, { name: "garmin", note: "Garmin Connect token" });
      assert.isUndefined(key?.lastUsedAt);
      // What the owner reads never carries the value.
      assert.notInclude(JSON.stringify(yield* service.list()), "s3cret");

      const taken = Option.getOrThrow(yield* service.use({ name: "garmin" }));
      assert.strictEqual(yield* fileSystem.readFileString(taken.file), "s3cret");
      assert.strictEqual((yield* fileSystem.stat(taken.file)).mode & 0o077, 0);
      assert.isDefined((yield* service.list()).keys[0]?.lastUsedAt);
      assert.isTrue(Option.isNone(yield* service.use({ name: "strava" })));

      // A new value keeps what the key is for.
      yield* service.save({ name: "garmin", value: "rotated" });
      assert.strictEqual((yield* service.list()).keys[0]?.note, "Garmin Connect token");

      yield* service.remove({ name: "garmin" });
      assert.deepEqual(yield* service.list(), { keys: [] });
      assert.isTrue(Option.isNone(yield* service.use({ name: "garmin" })));
    }),
  );

  it.effect("saves from a secret request's file and from no other path", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { service, config } = yield* setUp;
      const filesDir = path.join(config.secretsDir, "files");
      yield* fileSystem.makeDirectory(filesDir, { recursive: true });
      const asked = path.join(filesDir, "0123456789abcdef0123456789abcdef");
      yield* fileSystem.writeFileString(asked, "from-the-card");
      yield* service.save({ name: "strava", note: "", file: asked });
      const taken = Option.getOrThrow(yield* service.use({ name: "strava" }));
      assert.strictEqual(yield* fileSystem.readFileString(taken.file), "from-the-card");

      const elsewhere = path.join(config.stateDir, "settings.json");
      yield* fileSystem.writeFileString(elsewhere, "{}");
      const refused = yield* Effect.flip(service.save({ name: "leak", file: elsewhere }));
      assert.strictEqual(refused._tag, "MajordomeSavedKeysError");
      assert.deepEqual(
        (yield* service.list()).keys.map((key) => key.name),
        ["strava"],
      );
    }),
  );
});
