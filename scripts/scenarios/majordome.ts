// What Majordome's scenarios share. A project is a notes folder when it has a `.majordome` folder.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise } from "./t3.ts";

/** Files for `t3.project` that make the project a notes folder with two notes in it. */
export const NOTES_FOLDER = {
  ".majordome/config.json": "{}\n",
  "Welcome.md": "# Welcome\n\nThe first note.\n",
  "Other.md": "# Other\n\nAnother note.\n",
} as const;

const SettingsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeSettings = Schema.decodeEffect(SettingsJson);
const encodeSettings = Schema.encodeEffect(SettingsJson);

const withFiles = <A, E>(use: (fs: FileSystem.FileSystem) => Effect.Effect<A, E>) =>
  runPromise(Effect.flatMap(FileSystem.FileSystem, use));

/** The files a scenario checks or changes behind the app's back, as promises. */
export const files = {
  read: (file: string) => withFiles((fs) => fs.readFileString(file)),
  list: (folder: string) => withFiles((fs) => fs.readDirectory(folder)),
  makeFolder: (folder: string) => withFiles((fs) => fs.makeDirectory(folder, { recursive: true })),
  chmod: (file: string, mode: number) => withFiles((fs) => fs.chmod(file, mode)),
};

/**
 * Takes a notes folder the app made itself out of the app. The fixture only removes what
 * `t3.project` made, and the server outlives the test.
 */
export const forgetNotesFolder = (folder: string) =>
  runPromise(makeState(T3_HOME).cli(["project", "remove", folder, "--force"], [0, 1]));

/**
 * Empties the server's saved keys and secret sources, so a scenario about them starts from none
 * whatever an earlier one left: the server outlives each test. Run before the app opens.
 */
export const forgetSavedKeys = () =>
  runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const state = `${T3_HOME}/userdata`;
      for (const file of [
        "secrets/integration-keys.age",
        "secrets/integration-keys.agekey",
        "majordome/saved-keys.json",
      ]) {
        yield* fs.remove(`${state}/${file}`, { force: true });
      }
      // The server reads its settings file again when it changes.
      const settingsPath = `${state}/settings.json`;
      const settings = yield* decodeSettings(yield* fs.readFileString(settingsPath));
      if (settings.secretProviders !== undefined) {
        const { secretProviders: _sources, ...kept } = settings;
        yield* fs.writeFileString(settingsPath, yield* encodeSettings(kept));
      }
    }),
  );
