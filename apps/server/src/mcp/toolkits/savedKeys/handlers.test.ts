import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../../config.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as MajordomeSavedKeys from "../../../majordome/MajordomeSavedKeys.ts";
import { layerSavedKeysForTest } from "../../../majordome/MajordomeSavedKeys.testkit.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as SavedKeysHandlers from "./handlers.ts";
import { SavedKeysToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread:runs");

const layerAgent = Layer.mergeAll(
  Layer.succeed(McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment:home"),
    requestNamespace: "provider:runs",
    thread: {
      threadId,
      providerSessionId: "provider:runs",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    capabilities: new Set(["orchestration" as const]),
    issuedAt: 0,
  }),
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
  }),
  Layer.mock(ServerEnvironment.ServerEnvironment)({
    getDescriptor: Effect.succeed({ label: "Majordome server" } as ExecutionEnvironmentDescriptor),
  }),
);

it.effect(
  "tells the agent names and what each is for, never a value, and saves what it is given",
  () =>
    Effect.gen(function* () {
      const saved: Array<unknown> = [];
      const layerDependencies = Layer.mergeAll(
        layerAgent,
        Layer.mock(MajordomeSavedKeys.MajordomeSavedKeys)({
          list: () =>
            Effect.succeed({
              keys: [
                { name: "garmin", note: "Garmin token", lastUsedAt: "2026-11-20T10:00:00.000Z" },
                // The test clock starts in 1970: this key's last day is long past.
                { name: "old", note: "", expiresOn: "1969-12-01" },
              ],
            }),
          use: ({ name }) =>
            Effect.succeed(
              name === "strava"
                ? Option.none()
                : Option.some({ file: "/state/secrets/files/abc", masked: "g********n" }),
            ),
          setExpiry: (input) => {
            saved.push(input);
            return Effect.succeed({ name: input.name, note: "" });
          },
          save: (input) => {
            saved.push(input);
            return Effect.succeed({ name: input.name, note: input.note ?? "" });
          },
        }),
      );
      yield* Effect.gen(function* () {
        const toolkit = yield* SavedKeysToolkit;
        const result = <Name extends "list_saved_keys" | "use_saved_key" | "save_key">(
          name: Name,
          params: Parameters<typeof toolkit.handle<Name>>[1],
        ) =>
          toolkit.handle(name, params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );

        expect(yield* result("list_saved_keys", {})).toEqual({
          keys: [
            { name: "garmin", note: "Garmin token" },
            { name: "old", note: "", expires: "1969-12-01" },
          ],
        });
        // A key past its last day is still handed over, with a word for the owner.
        const ended = yield* result("use_saved_key", { name: "old" });
        expect(ended).toMatchObject({ status: "ready" });
        expect(ended).toHaveProperty("note", expect.stringContaining("stopped working after"));
        const good = yield* result("use_saved_key", { name: "garmin" });
        expect(good).toHaveProperty("note", expect.not.stringContaining("stop"));
        expect(yield* result("use_saved_key", { name: "garmin" })).toMatchObject({
          status: "ready",
          file: "/state/secrets/files/abc",
        });
        expect(yield* result("use_saved_key", { name: "strava" })).toEqual({
          status: "unknown_key",
          note: "No saved key has that name. Names: garmin, old.",
        });

        expect(
          yield* result("save_key", { name: "strava", note: "Rides", value: "stv_1" }),
        ).toMatchObject({ status: "saved" });
        yield* result("save_key", { name: "hue", note: "", file: "/state/secrets/files/def" });
        expect(saved).toEqual([
          { name: "strava", note: "Rides", value: "stv_1" },
          { name: "hue", note: "", file: "/state/secrets/files/def" },
        ]);
        // Neither a value nor a file: nothing is saved.
        expect(yield* result("save_key", { name: "empty", note: "" })).toMatchObject({
          code: "invalid_request",
        });
        expect(saved).toHaveLength(2);
        // A last day goes with a new key, and alone it dates the key already saved.
        yield* result("save_key", {
          name: "garmin",
          note: "Runs",
          value: "g_1",
          expires: "2027-11-25",
        });
        yield* result("save_key", { name: "garmin", note: "", expires: "2028-01-01" });
        expect(saved.slice(2)).toEqual([
          { name: "garmin", note: "Runs", value: "g_1", expiresOn: "2027-11-25" },
          { name: "garmin", expiresOn: "2028-01-01" },
        ]);
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(SavedKeysHandlers.layer).pipe(
            Layer.provideMerge(layerDependencies),
          ),
        ),
      );
    }),
);

it.layer(NodeServices.layer)("with the server's own key file", (it) => {
  it.effect(
    "an agent saves a key the owner pasted, sees it listed, and reads it back from a file",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const toolkit = yield* SavedKeysToolkit;
        const result = <Name extends "list_saved_keys" | "use_saved_key" | "save_key">(
          name: Name,
          params: Parameters<typeof toolkit.handle<Name>>[1],
        ) =>
          toolkit.handle(name, params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );

        // Each computer keeps its own keys: an empty list says which computer was looked at,
        // never that the owner has none. "myage" was on the Mac; the server said "no keys at all".
        const empty = yield* result("list_saved_keys", {});
        expect(empty).toMatchObject({ keys: [] });
        expect(empty).toHaveProperty(
          "note",
          expect.stringContaining("No keys are saved on Majordome server"),
        );
        expect(empty).toHaveProperty("note", expect.stringContaining("another of their computers"));
        expect(yield* result("use_saved_key", { name: "toto" })).toMatchObject({
          status: "unknown_key",
          note: expect.stringContaining("No keys are saved on Majordome server"),
        });

        expect(
          yield* result("save_key", { name: "toto", note: "A test", value: "test1234" }),
        ).toMatchObject({ status: "saved" });
        const listed = yield* result("list_saved_keys", {});
        expect(listed).toEqual({ keys: [{ name: "toto", note: "A test" }] });
        expect(JSON.stringify(listed)).not.toContain("test1234");

        // The key Bitwarden signs in with is the owner's: not listed for the agent, never handed over.
        yield* result("save_key", { name: "bitwarden", note: "", value: "0.token:part" });
        expect(yield* result("list_saved_keys", {})).toEqual(listed);
        expect(yield* result("use_saved_key", { name: "bitwarden" })).toMatchObject({
          code: "orchestration_error",
        });

        const taken = yield* result("use_saved_key", { name: "toto" });
        expect(taken).toMatchObject({ status: "ready" });
        const file = (taken as { readonly file: string }).file;
        expect(yield* fileSystem.readFileString(file)).toBe("test1234");
        // The reply carries where the key is, never the key.
        expect(JSON.stringify(taken)).not.toContain("test1234");

        // The owner says later how long it lasts: the day is kept with the key and listed.
        expect(
          yield* result("save_key", { name: "toto", note: "", expires: "2027-11-25" }),
        ).toMatchObject({ status: "saved" });
        expect(yield* result("list_saved_keys", {})).toEqual({
          keys: [{ name: "toto", note: "A test", expires: "2027-11-25" }],
        });
        expect(yield* fileSystem.readFileString(file)).toBe("test1234");
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(SavedKeysHandlers.layer).pipe(
            Layer.provideMerge(layerAgent),
            Layer.provideMerge(layerSavedKeysForTest("majordome-saved-keys-tools-")),
          ),
        ),
      ),
  );

  it.effect(
    "an agent saves a passport number with its last day, and it is on disk only encrypted",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const config = yield* ServerConfig.ServerConfig;
        const toolkit = yield* SavedKeysToolkit;
        const result = <Name extends "list_saved_keys" | "use_saved_key" | "save_key">(
          name: Name,
          params: Parameters<typeof toolkit.handle<Name>>[1],
        ) =>
          toolkit.handle(name, params).pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.map((parts) => parts.at(-1)?.result),
          );
        const number = "19AB12345";

        expect(
          yield* result("save_key", {
            name: "passport-number",
            note: "French passport",
            value: number,
            expires: "2031-04-02",
          }),
        ).toMatchObject({ status: "saved" });
        expect(yield* result("list_saved_keys", {})).toEqual({
          keys: [{ name: "passport-number", note: "French passport", expires: "2031-04-02" }],
        });

        // Nothing the server keeps holds the number in the clear.
        const kept = yield* fileSystem.readDirectory(config.stateDir, { recursive: true });
        expect(kept.some((file) => file.endsWith(".age"))).toBe(true);
        for (const file of kept) {
          const path = `${config.stateDir}/${file}`;
          if ((yield* fileSystem.stat(path)).type !== "File" || file.endsWith(".agekey")) continue;
          expect(yield* fileSystem.readFileString(path)).not.toContain(number);
        }

        // The reply carries the number masked, and says to answer the owner with that.
        const taken = yield* result("use_saved_key", { name: "passport-number" });
        expect(taken).toMatchObject({
          status: "ready",
          masked: `${number[0]}${"*".repeat(number.length - 2)}${number.at(-1)}`,
          note: expect.stringContaining("answer with `masked` and leave the file unread"),
        });
        expect(JSON.stringify(taken)).not.toContain(number);
        expect(yield* fileSystem.readFileString((taken as { readonly file: string }).file)).toBe(
          number,
        );
      }).pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(SavedKeysHandlers.layer).pipe(
            Layer.provideMerge(layerAgent),
            Layer.provideMerge(layerSavedKeysForTest("majordome-saved-number-tools-")),
          ),
        ),
      ),
  );
});
