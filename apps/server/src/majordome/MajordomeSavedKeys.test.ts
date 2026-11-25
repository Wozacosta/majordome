import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as MajordomeSavedKeys from "./MajordomeSavedKeys.ts";
import { layerSavedKeysForTest, TOTO } from "./MajordomeSavedKeys.testkit.ts";

const setUp = Effect.gen(function* () {
  const context = yield* Layer.build(layerSavedKeysForTest("majordome-saved-keys-"));
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

      // The last day is the owner's to set, change and clear; a replaced key starts without one.
      const dated = yield* service.setExpiry({ name: "garmin", expiresOn: "2027-11-25" });
      assert.deepInclude(dated, { note: "Garmin Connect token", expiresOn: "2027-11-25" });
      assert.isUndefined((yield* service.setExpiry({ name: "garmin", expiresOn: null })).expiresOn);
      yield* service.save({ name: "garmin", value: "third", expiresOn: "2027-12-01" });
      assert.strictEqual((yield* service.list()).keys[0]?.expiresOn, "2027-12-01");
      yield* service.save({ name: "garmin", value: "fourth" });
      assert.isUndefined((yield* service.list()).keys[0]?.expiresOn);
      const unknown = yield* Effect.flip(
        service.setExpiry({ name: "strava", expiresOn: "2027-01-01" }),
      );
      assert.strictEqual(unknown.message, "No saved key has that name.");

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

  it.effect("keeps a key that lives in a secret source by reference and reads it from there", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { service } = yield* setUp;
      // What the owner keeps in the source "toto": here the server's own key file.
      yield* service.save({ name: "garmin", value: "gm-1" });

      const kept = yield* service.save({
        name: "runs",
        note: "Garmin token",
        reference: { provider: TOTO, reference: "secret://garmin" },
      });
      assert.deepInclude(kept, { name: "runs", note: "Garmin token", source: "toto" });
      assert.deepEqual(
        (yield* service.list()).keys.map((key) => [key.name, key.source]),
        [
          ["garmin", undefined],
          ["runs", "toto"],
        ],
      );
      const read = (name: string) =>
        service.use({ name }).pipe(
          Effect.map(Option.getOrThrow),
          Effect.flatMap(({ file }) => fileSystem.readFileString(file)),
        );
      assert.strictEqual(yield* read("runs"), "gm-1");
      // Changed in the source: the next use gets the new key, with nothing saved again.
      yield* service.save({ name: "garmin", value: "gm-2" });
      assert.strictEqual(yield* read("runs"), "gm-2");

      // Nothing there to read: refused when saving, not when a routine needs it at night.
      const refused = yield* Effect.flip(
        service.save({
          name: "rides",
          reference: { provider: TOTO, reference: "secret://strava" },
        }),
      );
      assert.include(refused.message, "couldn't read that from toto");

      // Removing the key leaves what the source holds.
      yield* service.remove({ name: "runs" });
      assert.deepEqual(
        (yield* service.list()).keys.map((key) => key.name),
        ["garmin"],
      );
      assert.strictEqual(yield* read("garmin"), "gm-2");
    }),
  );

  it.effect("lists the key a source signs in with, and never hands it to an assistant", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp;
      yield* service.save({ name: "bitwarden", value: "0.token:part" });
      assert.strictEqual((yield* service.list()).keys[0]?.signsInTo, "My Bitwarden");
      const refused = yield* Effect.flip(service.use({ name: "bitwarden" }));
      assert.include(refused.message, "signs Majordome in to My Bitwarden");
    }),
  );
});
