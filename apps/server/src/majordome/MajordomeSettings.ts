/**
 * What an agent may read and change in Majordome's own settings, for the notes folder its
 * conversation works in. It only calls the services behind the settings screens; which changes
 * wait for the owner is decided in `settingsChanges.ts`.
 */

import {
  type MajordomeApprovalError,
  type MajordomeBackupStatus,
  type MajordomePrivateDocumentError,
  MajordomeRoutineLimits,
  type MajordomeRoutinesStatus,
  type MajordomeTopicsError,
  type MajordomeVaultError,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as MajordomeApprovals from "./MajordomeApprovals.ts";
import * as MajordomeBackup from "./MajordomeBackup.ts";
import * as MajordomeConnectors from "./MajordomeConnectors.ts";
import * as MajordomePrivateDocuments from "./MajordomePrivateDocuments.ts";
import * as MajordomePush from "./MajordomePush.ts";
import * as MajordomeRoutines from "./MajordomeRoutines.ts";
import * as MajordomeTopics from "./MajordomeTopics.ts";
import * as MajordomeVaultService from "./MajordomeVaultService.ts";
import { findDocumentByName } from "./privateDocumentStore.ts";
import { type MajordomeSettingChange, SETTING_CHANGE_RULES } from "./settingsChanges.ts";
import { VAULT_CONFIG_DIRNAME } from "./vaultConfig.ts";

const When = Schema.NullOr(Schema.String);

/** What the settings screens show, in words an agent can pass on. A part it could not read is null. */
export const MajordomeStatus = Schema.Struct({
  /** False when the conversation does not work in a notes folder: nothing else is filled in. */
  notesFolder: Schema.Boolean,
  backup: Schema.NullOr(
    Schema.Struct({
      lastSavedAt: When,
      problem: When,
      paused: Schema.NullOr(
        Schema.Struct({ why: Schema.String, files: Schema.Array(Schema.String) }),
      ),
      online: Schema.NullOr(
        Schema.Struct({
          where: Schema.String,
          syncing: Schema.Boolean,
          upToDate: Schema.Boolean,
          lastSentAt: When,
          problem: When,
        }),
      ),
      folder: Schema.NullOr(
        Schema.Struct({ path: Schema.String, lastCopyAt: When, problem: When }),
      ),
      googleDrive: Schema.NullOr(Schema.Struct({ lastCopyAt: When, problem: When })),
      signInNeeded: Schema.Array(Schema.Literals(["GitHub", "Google"])),
      hasPassphrase: Schema.Boolean,
    }),
  ),
  connections: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        ai: Schema.String,
        accounts: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            state: Schema.Literals([
              "set up",
              "needs a sign-in",
              "not working",
              "connecting",
              "turned off",
            ]),
          }),
        ),
        note: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  routines: Schema.NullOr(
    Schema.Struct({
      runBy: Schema.Literals(["this computer", "another computer", "no computer yet"]),
      blocked: When,
      limits: Schema.NullOr(MajordomeRoutineLimits),
      pausedForToday: Schema.Boolean,
    }),
  ),
  topics: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        folder: Schema.String,
        icon: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  privateDocuments: Schema.NullOr(Schema.Array(Schema.String)),
  notifications: Schema.NullOr(Schema.Struct({ devices: Schema.Array(Schema.String) })),
});
export type MajordomeStatus = typeof MajordomeStatus.Type;

export type SettingChangeResult =
  | { readonly status: "done"; readonly what: string }
  | { readonly status: "denied" | "timed_out" | "cancelled" | "waiting" }
  | { readonly status: "not_possible"; readonly why: string };

export type MajordomeSettingsError =
  | MajordomeApprovalError
  | MajordomePrivateDocumentError
  | MajordomeRoutines.MajordomeRoutinesError
  | MajordomeTopicsError
  | MajordomeVaultError;

export class MajordomeSettings extends Context.Service<
  MajordomeSettings,
  {
    /** Never fails: a part that could not be read is null. */
    readonly status: (input: { readonly threadId: ThreadId }) => Effect.Effect<MajordomeStatus>;
    /**
     * Makes one change for the conversation's notes folder. A risky one first waits for the
     * owner's yes on a card there, and does nothing on any other answer.
     */
    readonly change: (input: {
      readonly threadId: ThreadId;
      readonly change: MajordomeSettingChange;
    }) => Effect.Effect<SettingChangeResult, MajordomeSettingsError>;
  }
>()("t3/majordome/MajordomeSettings") {}

const NOT_A_NOTES_FOLDER: MajordomeStatus = {
  notesFolder: false,
  backup: null,
  connections: null,
  routines: null,
  topics: null,
  privateDocuments: null,
  notifications: null,
};

const PAUSED: Record<NonNullable<MajordomeBackupStatus["paused"]>["reason"], string> = {
  secret: "A possible secret was found in the notes, so saving is paused.",
  "secret-not-sent": "A possible secret was found in the notes, so syncing is paused.",
  conflict:
    "The notes here and in the online backup changed in the same place, so syncing is paused.",
  "unfinished-merge":
    "Bringing two versions of the notes together was left unfinished, so saving is paused.",
};

const DRIVE_PROBLEMS: Record<
  NonNullable<NonNullable<MajordomeBackupStatus["drive"]>["problem"]>,
  string | null
> = {
  "signed-out": "The Google sign-in has ended.",
  "access-removed": "Majordome's access to Google Drive was removed.",
  "quota-full": "Google Drive is full.",
  failed: null,
};

const CONNECTOR_STATES = {
  connected: "set up",
  "needs-auth": "needs a sign-in",
  failed: "not working",
  pending: "connecting",
  disabled: "turned off",
} as const;

function backupReport(status: MajordomeBackupStatus): NonNullable<MajordomeStatus["backup"]> {
  const { remote, drive } = status;
  const gitHubSignIn =
    remote?.isGitHub === true && remote.usesSignIn !== false && !status.github.signedIn;
  const googleSignIn =
    drive !== null &&
    (!status.googleDrive.signedIn ||
      drive.problem === "signed-out" ||
      drive.problem === "access-removed");
  return {
    lastSavedAt: status.lastSavedAt,
    problem: status.saveError,
    paused:
      status.paused === null
        ? null
        : { why: PAUSED[status.paused.reason], files: status.paused.files },
    online:
      remote === null
        ? null
        : {
            where: remote.isGitHub ? "GitHub" : (remote.host ?? "a folder on this computer"),
            syncing: remote.syncing,
            upToDate: remote.backedUp,
            lastSentAt: remote.lastSyncedAt,
            problem: remote.lastError,
          },
    folder:
      status.folder === null
        ? null
        : {
            path: status.folder.path,
            lastCopyAt: status.folder.lastBackupAt,
            problem: status.folder.lastError,
          },
    googleDrive:
      drive === null
        ? null
        : {
            lastCopyAt: drive.lastBackupAt,
            problem:
              (drive.problem === null ? null : DRIVE_PROBLEMS[drive.problem]) ?? drive.lastError,
          },
    signInNeeded: [
      ...(gitHubSignIn ? (["GitHub"] as const) : []),
      ...(googleSignIn ? (["Google"] as const) : []),
    ],
    hasPassphrase: status.hasPassphrase,
  };
}

function routinesBlocked(status: MajordomeRoutinesStatus | undefined): string | null {
  if (status === undefined || status.ready) return null;
  const ai = status.provider ?? "the AI they use";
  switch (status.reason) {
    case "not-created":
      return "Routines are still being set up.";
    case "provider-signed-out":
      return `Routines can't run: ${ai} is signed out.`;
    case "provider-unavailable":
      return `Routines can't run: ${ai} isn't available.`;
    default:
      return "Routines can't run: no AI is signed in.";
  }
}

const notPossible = (why: string): SettingChangeResult => ({ status: "not_possible", why });

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const approvals = yield* MajordomeApprovals.MajordomeApprovals;
  const backup = yield* MajordomeBackup.MajordomeBackup;
  const connectors = yield* MajordomeConnectors.MajordomeConnectors;
  const privateDocuments = yield* MajordomePrivateDocuments.MajordomePrivateDocuments;
  const push = yield* MajordomePush.MajordomePush;
  const routines = yield* MajordomeRoutines.MajordomeRoutines;
  const topics = yield* MajordomeTopics.MajordomeTopics;
  const vault = yield* MajordomeVaultService.MajordomeVaultService;

  /** The notes folder the conversation works in, as its project; null when it has none. */
  const vaultOf = Effect.fn("MajordomeSettings.vaultOf")(
    function* (threadId: ThreadId) {
      const thread = yield* projections.getThreadShell(threadId);
      if (thread === null) return null;
      const project = Option.getOrUndefined(yield* projects.get(thread.projectId));
      if (project === undefined) return null;
      const isVault = yield* fileSystem.exists(
        path.join(project.workspaceRoot, VAULT_CONFIG_DIRNAME),
      );
      return isVault ? thread.projectId : null;
    },
    Effect.orElseSucceed(() => null),
  );

  const part = <A, E>(name: string, read: Effect.Effect<A, E>) =>
    read.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Majordome could not read a part of its status.", { name, cause }).pipe(
          Effect.as(null),
        ),
      ),
    );

  const status: MajordomeSettings["Service"]["status"] = Effect.fn("MajordomeSettings.status")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({ "orchestration_v2.thread_id": input.threadId });
      const projectId = yield* vaultOf(input.threadId);
      if (projectId === null) return NOT_A_NOTES_FOLDER;
      return yield* Effect.all(
        {
          notesFolder: Effect.succeed(true),
          backup: part("backup", backup.getStatus({ projectId }).pipe(Effect.map(backupReport))),
          connections: part(
            "connections",
            connectors.list({}).pipe(
              Effect.map(({ providers }) =>
                providers.map((provider) => {
                  const note = !provider.reported
                    ? "This AI cannot list the accounts it reaches."
                    : provider.error;
                  return {
                    ai: provider.displayName ?? provider.driver,
                    accounts: provider.connectors.map((connector) => ({
                      name: connector.name,
                      state: CONNECTOR_STATES[connector.status],
                    })),
                    ...(note === undefined ? {} : { note }),
                  };
                }),
              ),
            ),
          ),
          routines: part(
            "routines",
            vault.listHistory({ projectId, limit: 1 }).pipe(
              Effect.map((history) => ({
                runBy:
                  history.routinesRunner === "this-server"
                    ? ("this computer" as const)
                    : history.routinesRunner === "another-server"
                      ? ("another computer" as const)
                      : ("no computer yet" as const),
                blocked: routinesBlocked(history.routinesStatus),
                limits: history.routineLimits ?? null,
                pausedForToday: history.pausedToday === true,
              })),
            ),
          ),
          topics: part(
            "topics",
            topics.list({ projectId }).pipe(
              Effect.map((result) =>
                result.topics.map(({ id, title, folder, icon }) => ({
                  id,
                  title,
                  folder,
                  ...(icon === undefined ? {} : { icon }),
                })),
              ),
            ),
          ),
          privateDocuments: part(
            "private documents",
            privateDocuments
              .list()
              .pipe(Effect.map(({ documents }) => documents.map((document) => document.name))),
          ),
          notifications: part(
            "notifications",
            push.listDevices().pipe(
              Effect.map(({ devices }) => ({
                devices: devices.map((device) => device.label ?? "A device"),
              })),
            ),
          ),
        },
        { concurrency: "unbounded" },
      );
    },
  );

  /** What a change will do, in the words its card shows, and how; a string says why it cannot. */
  const plan = Effect.fn("MajordomeSettings.plan")(function* (
    projectId: ProjectId,
    change: MajordomeSettingChange,
  ): Effect.fn.Return<
    | string
    | { readonly what: string; readonly apply: Effect.Effect<unknown, MajordomeSettingsError> },
    MajordomeSettingsError
  > {
    const configure = (backupChange: Parameters<typeof backup.configure>[0]["change"]) =>
      backup.configure({ projectId, change: backupChange });
    switch (change.type) {
      case "back_up_now":
        return { what: "Back up the notes now", apply: backup.backUpNow({ projectId }) };
      case "turn_backup_syncing_on":
        return {
          what: "Send notes to the online backup again",
          apply: configure({ type: "set-syncing", enabled: true }),
        };
      case "turn_backup_syncing_off":
        return {
          what: "Stop sending notes to the online backup",
          apply: configure({ type: "set-syncing", enabled: false }),
        };
      case "remove_folder_backup":
        return {
          what: "Stop the nightly copy to the backup folder",
          apply: configure({ type: "remove-folder" }),
        };
      case "disconnect_google_drive":
        return {
          what: "Disconnect Google Drive",
          apply: configure({ type: "disconnect-google-drive" }),
        };
      case "forget_github_sign_in":
        return {
          what: "Forget the GitHub sign-in",
          apply: configure({ type: "disconnect-github" }),
        };
      case "set_routine_limits": {
        const { runMinutes, runsPerDay } = change;
        return {
          what: `Let a routine work for up to ${runMinutes} minutes, and up to ${runsPerDay} start per day`,
          apply: vault.setRoutineLimits({ projectId, limits: { runMinutes, runsPerDay } }),
        };
      }
      case "run_routines_here":
        return { what: "Run routines on this computer", apply: routines.runHere(projectId) };
      case "create_topic":
        return {
          what: `Add the topic “${change.title}”`,
          apply: topics.create({
            projectId,
            title: change.title,
            folder: change.folder,
            createFolder: true,
          }),
        };
      case "reorder_topics":
        return {
          what: "Change the order of topics",
          apply: topics.reorder({ projectId, topicIds: change.topicIds }),
        };
      case "update_topic":
      case "remove_topic": {
        const known = (yield* topics.list({ projectId })).topics;
        const topic = known.find((candidate) => candidate.id === change.topicId);
        if (topic === undefined) {
          return `No topic has the id “${change.topicId}”. Topics: ${
            known.map((candidate) => `${candidate.title} (${candidate.id})`).join("; ") || "none"
          }.`;
        }
        if (change.type === "remove_topic") {
          return {
            what: `Remove the topic “${topic.title}”`,
            apply: topics.remove({ projectId, topicId: topic.id }),
          };
        }
        if (change.title === undefined && change.icon === undefined) {
          return "Say a new `title` or `icon` for the topic.";
        }
        return {
          what: `Update the topic “${topic.title}”`,
          apply: topics.update({
            projectId,
            topicId: topic.id,
            ...(change.title === undefined ? {} : { title: change.title }),
            ...(change.icon === undefined ? {} : { icon: change.icon }),
          }),
        };
      }
      case "remove_private_document": {
        const { documents } = yield* privateDocuments.list();
        const document = findDocumentByName(documents, change.name);
        if (document === undefined) {
          return `No private document is named “${change.name}”. Names: ${
            documents.map((candidate) => candidate.name).join("; ") || "none"
          }.`;
        }
        return {
          what: `Delete the private document “${document.name}”`,
          apply: privateDocuments.remove({ id: document.id }),
        };
      }
      default:
        return "An assistant cannot make this change.";
    }
  });

  const change: MajordomeSettings["Service"]["change"] = Effect.fn("MajordomeSettings.change")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({
        "orchestration_v2.thread_id": input.threadId,
        "setting_change.type": input.change.type,
      });
      const rule = SETTING_CHANGE_RULES[input.change.type];
      if (rule.risk === "owner_only") {
        return notPossible(
          `Only the owner can ${rule.does}, on the app's own screen: ${rule.where}. Tell them where to go; don't ask for a password, key or code here.`,
        );
      }
      const projectId = yield* vaultOf(input.threadId);
      if (projectId === null) {
        return notPossible("This conversation does not work in a notes folder.");
      }
      const planned = yield* plan(projectId, input.change);
      if (typeof planned === "string") return notPossible(planned);
      if (rule.risk === "approval") {
        const answer = yield* approvals.request({
          threadId: input.threadId,
          title: planned.what,
          detail: rule.detail,
        });
        if (answer !== "allowed") return { status: answer };
      }
      yield* planned.apply;
      return { status: "done", what: planned.what };
    },
  );

  return MajordomeSettings.of({ status, change });
});

export const layer = Layer.effect(MajordomeSettings, make);
