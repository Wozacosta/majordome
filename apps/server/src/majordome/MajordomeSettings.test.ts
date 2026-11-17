import { assert, describe, it } from "@effect/vitest";
import {
  type MajordomeBackupStatus,
  MajordomeVaultError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as MajordomeApprovals from "./MajordomeApprovals.ts";
import * as MajordomeBackup from "./MajordomeBackup.ts";
import * as MajordomeConnectors from "./MajordomeConnectors.ts";
import * as MajordomePrivateDocuments from "./MajordomePrivateDocuments.ts";
import * as MajordomePush from "./MajordomePush.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import * as MajordomeSettings from "./MajordomeSettings.ts";
import * as MajordomeTopics from "./MajordomeTopics.ts";
import * as MajordomeVaultService from "./MajordomeVaultService.ts";
import { type MajordomeSettingChange, SETTING_CHANGE_RULES } from "./settingsChanges.ts";

const threadId = ThreadId.make("thread:assistant");
const PASSPORT_ID = "0123456789abcdef0123456789abcdef";

/** One of every change: a type added to the union does not compile until it is tried here. */
const SAMPLES: {
  readonly [Type in MajordomeSettingChange["type"]]: MajordomeSettingChange & {
    readonly type: Type;
  };
} = {
  back_up_now: { type: "back_up_now" },
  turn_backup_syncing_on: { type: "turn_backup_syncing_on" },
  set_routine_limits: { type: "set_routine_limits", runMinutes: 30, runsPerDay: 10 },
  create_topic: { type: "create_topic", title: "Fitness", folder: "projects/fitness" },
  update_topic: { type: "update_topic", topicId: "taxes", icon: "wallet" },
  reorder_topics: { type: "reorder_topics", topicIds: ["taxes"] },
  turn_backup_syncing_off: { type: "turn_backup_syncing_off" },
  remove_folder_backup: { type: "remove_folder_backup" },
  disconnect_google_drive: { type: "disconnect_google_drive" },
  forget_github_sign_in: { type: "forget_github_sign_in" },
  remove_topic: { type: "remove_topic", topicId: "taxes" },
  remove_private_document: { type: "remove_private_document", name: "passport" },
  run_routines_here: { type: "run_routines_here" },
  sign_in_github: { type: "sign_in_github" },
  sign_in_google: { type: "sign_in_google" },
  sign_in_ai: { type: "sign_in_ai" },
  set_backup_passphrase: { type: "set_backup_passphrase" },
  add_private_document: { type: "add_private_document" },
  pair_phone: { type: "pair_phone" },
  set_up_always_on_server: { type: "set_up_always_on_server" },
  turn_on_notifications: { type: "turn_on_notifications" },
};

/** What each change that acts must have asked of the service behind its screen. */
const ACTS: Partial<Record<MajordomeSettingChange["type"], string>> = {
  back_up_now: "backup.backUpNow",
  turn_backup_syncing_on: 'backup.configure {"type":"set-syncing","enabled":true}',
  set_routine_limits: 'vault.setRoutineLimits {"runMinutes":30,"runsPerDay":10}',
  create_topic: 'topics.create {"title":"Fitness","folder":"projects/fitness","createFolder":true}',
  update_topic: 'topics.update {"topicId":"taxes","icon":"wallet"}',
  reorder_topics: 'topics.reorder ["taxes"]',
  turn_backup_syncing_off: 'backup.configure {"type":"set-syncing","enabled":false}',
  remove_folder_backup: 'backup.configure {"type":"remove-folder"}',
  disconnect_google_drive: 'backup.configure {"type":"disconnect-google-drive"}',
  forget_github_sign_in: 'backup.configure {"type":"disconnect-github"}',
  remove_topic: "topics.remove taxes",
  remove_private_document: `privateDocuments.remove ${PASSPORT_ID}`,
  run_routines_here: "routines.runHere",
};

const backupStatus: MajordomeBackupStatus = {
  isVault: true,
  lastSavedAt: "2026-11-17T08:00:00.000Z",
  saveError: null,
  paused: {
    reason: "secret-not-sent",
    files: ["inbox/keys.md"],
    since: "2026-11-17T08:00:00.000Z",
  },
  remote: {
    name: "origin",
    host: "github.com",
    isGitHub: true,
    usesSignIn: true,
    webUrl: "https://github.com/acme/majordome-brain",
    syncing: true,
    backedUp: false,
    lastSyncedAt: "2026-11-16T08:00:00.000Z",
    lastError: null,
  },
  folder: null,
  drive: { lastBackupAt: null, lastFile: null, lastError: "401", problem: "signed-out" },
  hasPassphrase: true,
  googleDrive: { available: true, signedIn: true },
  github: { available: true, signedIn: false },
  secretScan: true,
};

/**
 * The settings service over fakes of the services behind each screen. `log` holds, in order, every
 * question put to the owner and every change made.
 */
const withSettings = <A, E>(
  body: (input: {
    readonly service: MajordomeSettings.MajordomeSettings["Service"];
    readonly log: Array<string>;
  }) => Effect.Effect<A, E>,
  options: {
    readonly answer?: MajordomeApprovals.ApprovalStatus;
    readonly isVault?: boolean;
    readonly backupFails?: boolean;
  } = {},
) => {
  const log: Array<string> = [];
  const did = (what: string, detail?: unknown) =>
    Effect.sync(() => {
      log.push(detail === undefined ? what : `${what} ${JSON.stringify(detail)}`);
    });
  const dependencies = Layer.mergeAll(
    FileSystem.layerNoop({ exists: () => Effect.succeed(options.isVault ?? true) }),
    Path.layer,
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () => Effect.succeedSome({ workspaceRoot: "/home/user/notes" } as never),
    }),
    Layer.mock(MajordomeApprovals.MajordomeApprovals)({
      request: ({ title }) =>
        did(`ask: ${title}`).pipe(Effect.as(options.answer ?? ("allowed" as const))),
    }),
    Layer.mock(MajordomeBackup.MajordomeBackup)({
      getStatus: () =>
        options.backupFails === true
          ? Effect.fail(new MajordomeVaultError({ message: "Could not read the backup." }))
          : Effect.succeed(backupStatus),
      backUpNow: () => did("backup.backUpNow").pipe(Effect.as(backupStatus)),
      configure: ({ change }) => did("backup.configure", change).pipe(Effect.as(backupStatus)),
    }),
    Layer.mock(MajordomeConnectors.MajordomeConnectors)({
      list: () =>
        Effect.succeed({
          checkedAt: "2026-11-17T08:00:00.000Z",
          providers: [
            {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              driver: "claudeAgent" as never,
              displayName: "Claude",
              reported: true,
              connectors: [
                { name: "claude.ai Gmail", status: "connected" as const },
                { name: "claude.ai Google Calendar", status: "needs-auth" as const },
              ],
            },
          ],
        }),
    }),
    Layer.mock(MajordomePrivateDocuments.MajordomePrivateDocuments)({
      list: () =>
        Effect.succeed({
          documents: [
            {
              id: PASSPORT_ID,
              name: "Passport",
              description: "",
              fileName: "passport.pdf",
              mediaType: "application/pdf",
              sizeBytes: 1,
              addedAt: "2026-11-01T09:00:00.000Z",
            },
          ],
          accessLog: [],
        }),
      remove: ({ id }) => did(`privateDocuments.remove ${id}`),
    }),
    Layer.mock(MajordomePush.MajordomePush)({
      listDevices: () =>
        Effect.succeed({
          devices: [
            { endpoint: "https://push.example/1", label: "iPhone · Safari", addedAt: null },
          ],
        }),
    }),
    Layer.mock(MajordomeRoutines.MajordomeRoutines)({ runHere: () => did("routines.runHere") }),
    Layer.mock(MajordomeTopics.MajordomeTopics)({
      list: () =>
        Effect.succeed({
          isVault: true,
          topics: [
            {
              id: "taxes",
              title: "Taxes",
              folder: "admin/taxes",
              threadId: null,
              folderExists: true,
              keyNote: null,
            },
          ],
          suggestions: [],
          folders: [],
          projectsFolder: "projects",
        }),
      create: ({ projectId: _, ...topic }) =>
        did("topics.create", topic).pipe(Effect.as({} as never)),
      update: ({ projectId: _, ...topic }) =>
        did("topics.update", topic).pipe(Effect.as({} as never)),
      reorder: ({ topicIds }) => did("topics.reorder", topicIds),
      remove: ({ topicId }) => did(`topics.remove ${topicId}`),
    }),
    Layer.mock(MajordomeVaultService.MajordomeVaultService)({
      listHistory: () =>
        Effect.succeed({
          isVault: true,
          entries: [],
          routinesRunner: "this-server" as const,
          routinesStatus: {
            ready: false,
            reason: "provider-signed-out" as const,
            provider: "Claude",
          },
          routineLimits: { runMinutes: 20, runsPerDay: 20 },
          pausedToday: false,
        }),
      setRoutineLimits: ({ limits }) =>
        did("vault.setRoutineLimits", limits).pipe(Effect.as(limits)),
    }),
  );
  return Effect.gen(function* () {
    return yield* body({ service: yield* MajordomeSettings.MajordomeSettings, log });
  }).pipe(Effect.provide(MajordomeSettings.layer.pipe(Layer.provide(dependencies))));
};

const changes = Object.values(SAMPLES).map((change) => ({
  change,
  rule: SETTING_CHANGE_RULES[change.type],
}));
const withRisk = (risk: "free" | "approval" | "owner_only") =>
  changes.filter(({ rule }) => rule.risk === risk).map(({ change }) => change);

describe("MajordomeSettings.change", () => {
  it.effect.each(withRisk("free"))("$type is done at once, without asking", (change) =>
    withSettings(({ service, log }) =>
      Effect.gen(function* () {
        const result = yield* service.change({ threadId, change });
        assert.strictEqual(result.status, "done");
        assert.deepStrictEqual(log, [ACTS[change.type]]);
      }),
    ),
  );

  it.effect.each(withRisk("approval"))("$type waits for the owner's yes", (change) =>
    Effect.gen(function* () {
      for (const answer of ["denied", "timed_out", "cancelled", "waiting"] as const) {
        yield* withSettings(
          ({ service, log }) =>
            Effect.gen(function* () {
              assert.deepStrictEqual(yield* service.change({ threadId, change }), {
                status: answer,
              });
              assert.strictEqual(log.length, 1);
              assert.match(log[0] ?? "", /^ask: /);
            }),
          { answer },
        );
      }
      yield* withSettings(({ service, log }) =>
        Effect.gen(function* () {
          const result = yield* service.change({ threadId, change });
          assert.strictEqual(result.status, "done");
          assert.match(log[0] ?? "", /^ask: /);
          assert.deepStrictEqual(log.slice(1), [ACTS[change.type]]);
        }),
      );
    }),
  );

  it.effect.each(withRisk("owner_only"))(
    "$type is never tried: the answer is where to go",
    (change) =>
      withSettings(({ service, log }) =>
        Effect.gen(function* () {
          const rule = SETTING_CHANGE_RULES[change.type];
          const result = yield* service.change({ threadId, change });
          assert.strictEqual(result.status, "not_possible");
          if (result.status !== "not_possible" || rule.risk !== "owner_only") return;
          assert.include(result.why, rule.where);
          assert.deepStrictEqual(log, []);
        }),
      ),
  );

  it.effect("names the thing on the card, and asks nothing about a thing that is not there", () =>
    withSettings(({ service, log }) =>
      Effect.gen(function* () {
        yield* service.change({ threadId, change: SAMPLES.remove_topic });
        yield* service.change({ threadId, change: SAMPLES.remove_private_document });
        assert.deepStrictEqual(
          log.filter((line) => line.startsWith("ask: ")),
          ["ask: Remove the topic “Taxes”", "ask: Delete the private document “Passport”"],
        );

        log.length = 0;
        const unknownTopic = yield* service.change({
          threadId,
          change: { type: "remove_topic", topicId: "fitness" },
        });
        const unknownDocument = yield* service.change({
          threadId,
          change: { type: "remove_private_document", name: "Diploma" },
        });
        assert.deepInclude(unknownTopic, { status: "not_possible" });
        assert.deepStrictEqual(unknownDocument, {
          status: "not_possible",
          why: "No private document is named “Diploma”. Names: Passport.",
        });
        assert.deepStrictEqual(log, []);
      }),
    ),
  );

  it.effect("changes nothing for a conversation outside a notes folder", () =>
    withSettings(
      ({ service, log }) =>
        Effect.gen(function* () {
          const result = yield* service.change({ threadId, change: SAMPLES.remove_folder_backup });
          assert.strictEqual(result.status, "not_possible");
          assert.deepStrictEqual(log, []);
          assert.deepInclude(yield* service.status({ threadId }), {
            notesFolder: false,
            backup: null,
          });
        }),
      { isVault: false },
    ),
  );
});

describe("MajordomeSettings.status", () => {
  it.effect("reports what the settings screens show, in plain words", () =>
    withSettings(({ service }) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* service.status({ threadId }), {
          notesFolder: true,
          backup: {
            summary:
              "Set up to back up to GitHub, Google Drive, but something is wrong; see the problems below.",
            lastSavedAt: "2026-11-17T08:00:00.000Z",
            problem: null,
            paused: {
              why: "A possible secret was found in the notes, so syncing is paused.",
              files: ["inbox/keys.md"],
            },
            twoVersions: [],
            online: {
              where: "GitHub",
              syncing: true,
              upToDate: false,
              lastSentAt: "2026-11-16T08:00:00.000Z",
              problem: null,
            },
            folder: null,
            googleDrive: { lastCopyAt: null, problem: "The Google sign-in has ended." },
            signInNeeded: ["GitHub", "Google"],
            hasPassphrase: true,
          },
          connections: [
            {
              ai: "Claude",
              accounts: [
                { name: "claude.ai Gmail", state: "set up" },
                { name: "claude.ai Google Calendar", state: "needs a sign-in" },
              ],
            },
          ],
          routines: {
            runBy: "this computer",
            blocked: "Routines can't run: Claude is signed out.",
            limits: { runMinutes: 20, runsPerDay: 20 },
            pausedForToday: false,
          },
          topics: [{ id: "taxes", title: "Taxes", folder: "admin/taxes" }],
          privateDocuments: ["Passport"],
          notifications: { devices: ["iPhone · Safari"] },
        });
      }),
    ),
  );

  it.effect("leaves out only the part it could not read", () =>
    withSettings(
      ({ service }) =>
        Effect.gen(function* () {
          const status = yield* service.status({ threadId });
          assert.isNull(status.backup);
          assert.deepStrictEqual(status.privateDocuments, ["Passport"]);
        }),
      { backupFails: true },
    ),
  );
});
