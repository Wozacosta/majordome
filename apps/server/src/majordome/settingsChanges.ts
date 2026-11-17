/**
 * The changes an agent can ask for in Majordome's settings, and for each one whether it just
 * happens, waits for the owner's yes, or is the owner's alone. `SETTING_CHANGE_RULES` is the one
 * place that decides; the tool's description, the service and the tests read it.
 */

import {
  MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX,
  MajordomeRoutineLimits,
  MajordomeTopicIcon,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** One struct for every change that is its name alone, which keeps the advertised schema small. */
const NamedChange = Schema.Struct({
  type: Schema.Literals([
    "back_up_now",
    "turn_backup_syncing_on",
    "turn_backup_syncing_off",
    "remove_folder_backup",
    "disconnect_google_drive",
    "forget_github_sign_in",
    "run_routines_here",
    "sign_in_github",
    "sign_in_google",
    "sign_in_ai",
    "set_backup_passphrase",
    "add_private_document",
    "pair_phone",
    "set_up_always_on_server",
    "turn_on_notifications",
  ]),
});

export const MajordomeSettingChange = Schema.Union([
  NamedChange,
  Schema.Struct({ type: Schema.Literal("set_routine_limits"), ...MajordomeRoutineLimits.fields }),
  Schema.Struct({
    type: Schema.Literal("create_topic"),
    title: TrimmedNonEmptyString,
    /** Relative to the notes folder; made when it does not exist. */
    folder: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("update_topic"),
    topicId: TrimmedNonEmptyString,
    title: Schema.optionalKey(TrimmedNonEmptyString),
    icon: Schema.optionalKey(
      Schema.NullOr(MajordomeTopicIcon).annotate({ description: "Null picks one from the title." }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("reorder_topics"),
    topicIds: Schema.Array(TrimmedNonEmptyString).annotate({
      description: "Every topic id, in the new order.",
    }),
  }),
  Schema.Struct({ type: Schema.Literal("remove_topic"), topicId: TrimmedNonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("remove_private_document"),
    name: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAJORDOME_PRIVATE_DOCUMENT_NAME_MAX),
    ),
  }),
]);
export type MajordomeSettingChange = typeof MajordomeSettingChange.Type;

export type SettingChangeRule =
  /** Done at once. */
  | { readonly risk: "free" }
  /** Done only after the owner allows it on a card; `detail` is what the card says it means. */
  | { readonly risk: "approval"; readonly detail: string }
  /** Never done by an agent: the answer is that only the owner `does` it, and `where`. */
  | { readonly risk: "owner_only"; readonly does: string; readonly where: string };

const BACKUP = "Settings, then Back up my brain";

export const SETTING_CHANGE_RULES: {
  readonly [Type in MajordomeSettingChange["type"]]: SettingChangeRule;
} = {
  back_up_now: { risk: "free" },
  turn_backup_syncing_on: { risk: "free" },
  create_topic: { risk: "free" },
  update_topic: { risk: "free" },
  reorder_topics: { risk: "free" },
  // The limits cap what Majordome does on its own, so it never moves them by itself.
  set_routine_limits: {
    risk: "approval",
    detail:
      "This changes how many routines Majordome may run each day and how long one may take. Higher limits can use more of your AI plan.",
  },
  turn_backup_syncing_off: {
    risk: "approval",
    detail:
      "Notes are still saved on this computer, but new changes stop reaching the online backup until syncing is turned on again.",
  },
  remove_folder_backup: {
    risk: "approval",
    detail:
      "No new encrypted copies are written to the backup folder. The copies already there stay, and you still need your passphrase to open them: Majordome forgets it unless Google Drive copies use it.",
  },
  disconnect_google_drive: {
    risk: "approval",
    detail:
      "No new copies go to Google Drive, and Majordome's access to it is withdrawn. Connecting again needs a new Google sign-in.",
  },
  forget_github_sign_in: {
    risk: "approval",
    detail:
      "Majordome can no longer send notes to GitHub from this computer until you sign in again. The notes already on GitHub stay.",
  },
  remove_topic: {
    risk: "approval",
    detail:
      "The topic leaves the sidebar. Its folder and notes stay, and its conversation moves to the recent chats.",
  },
  remove_private_document: {
    risk: "approval",
    detail: "The document is deleted from Majordome for good. This cannot be undone.",
  },
  run_routines_here: {
    risk: "approval",
    detail:
      "Routines and the inbox watcher run on this computer from now on, and stop on the one that ran them once it hears of the move.",
  },
  sign_in_github: { risk: "owner_only", does: "sign in to GitHub", where: BACKUP },
  sign_in_google: { risk: "owner_only", does: "sign in to Google Drive", where: BACKUP },
  sign_in_ai: {
    risk: "owner_only",
    does: "sign in to Claude or another AI",
    where: "Settings, then Providers",
  },
  set_backup_passphrase: {
    risk: "owner_only",
    does: "choose a backup folder or its passphrase",
    where: BACKUP,
  },
  add_private_document: {
    risk: "owner_only",
    does: "add a private document",
    where: "Settings, then Private documents",
  },
  pair_phone: { risk: "owner_only", does: "set up a phone", where: "Settings, then Your phone" },
  set_up_always_on_server: {
    risk: "owner_only",
    does: "set up or remove an always-on server",
    where: "Settings, then Always-on server",
  },
  turn_on_notifications: {
    risk: "owner_only",
    does: "let a device get notifications",
    where: "Settings, then Notifications, on that device",
  },
};

const typesWith = (risk: SettingChangeRule["risk"]) =>
  Object.entries(SETTING_CHANGE_RULES)
    .filter(([, rule]) => rule.risk === risk)
    .map(([type]) => `\`${type}\``)
    .join(", ");

/** The part of the tool's description that sorts every change by what happens when it is asked. */
export const SETTING_CHANGES_GUIDE = [
  `Done at once: ${typesWith("free")}.`,
  `Shows the owner a card to allow first: ${typesWith("approval")}.`,
  `Never done for them, the answer says where they do it: ${typesWith("owner_only")}.`,
].join(" ");
