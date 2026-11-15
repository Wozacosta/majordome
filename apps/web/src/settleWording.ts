import { isMajordome } from "./env";

/**
 * What the app calls settling a thread. Majordome says "done": its owners finish chats, they do
 * not triage coding work. Code, settings keys and contracts keep T3's names.
 */
export const SETTLE_WORDS = isMajordome
  ? {
      settleButton: "Done",
      settleThread: "Mark as done",
      settleMany: (count: number) => `Mark ${count} as done`,
      settledSection: "Done",
      settledSince: (when: string) => `Done ${when}`,
      unsettle: "Bring back",
      unsettleThread: "Bring back",
      unsettling: "Bringing back...",
      settleFailed: "Could not mark as done",
      unsettleFailed: "Could not bring it back",
      undoSettleFailed: "Could not undo marking as done",
      settleUnsupported:
        "This environment's server cannot mark chats as done yet. Update the server to use Done.",
      autoSettleMenu: "Move to Done when inactive",
      autoSettleFailed: "Could not change moving to Done",
      autoSettleUnsupported:
        "This environment's server cannot keep a chat out of Done yet. Update the server to use it.",
      undoneAction: "marking as done",
      settledNotice: "Done",
      settledSummary: (count: string) => `Marked ${count} as done`,
      keybinding: "Thread: Mark as Done",
      settingsSection: "Moving chats to Done",
      autoSettleMergedTitle: "Move merged chats to Done",
      autoSettleMergedDescription:
        "Move a chat to Done when its pull request merges. Closed pull requests still move it.",
      autoSettleMergedReset: "moving merged chats to Done",
      autoSettleInactiveTitle: "Move inactive chats to Done",
      autoSettleInactiveDescription: (days: number | null) =>
        `Move chats to Done after ${days ?? "a few"} days without activity.`,
      autoSettleInactiveReset: "moving chats to Done",
      autoSettleDaysTitle: "Days before chats move to Done",
      autoSettleDaysDescription: "Any new activity brings a chat back automatically.",
      autoSettleDaysLabel: "Days of inactivity before a chat moves to Done",
      keepPullRequestsDescription:
        "Inactivity does not move chats with a pull request to Done. Merge and close still do.",
      deleteSettledWorktrees: "Delete worktrees of done chats",
      deleteSettledWorktreesDescription:
        "Remove worktrees this many days after their chat is done. Set 0 days to remove them at the next cleanup. Branches and chat history are kept.",
      scriptRunOnSettle: "Run in the chat's worktree when the chat is done",
      scriptStopOnSettle: "Stop this action when the chat is done",
      projectFoldersDescription:
        "Group sidebar chats into project folders. Pinned chats stay on top, and Snoozed and Done stay below the folders.",
      /** People coming from T3 Code still search for "settle". */
      searchKeywords: "done settle settled auto-settle",
    }
  : {
      settleButton: "Settle",
      settleThread: "Settle thread",
      settleMany: (count: number) => `Settle (${count})`,
      settledSection: "Settled",
      settledSince: (when: string) => `Settled ${when}`,
      unsettle: "Un-settle",
      unsettleThread: "Un-settle thread",
      unsettling: "Un-settling...",
      settleFailed: "Failed to settle thread",
      unsettleFailed: "Failed to un-settle thread",
      undoSettleFailed: "Failed to undo settle",
      settleUnsupported:
        "This environment's server does not support settling yet. Update the server to use Settle.",
      autoSettleMenu: "Auto-settle behavior",
      autoSettleFailed: "Failed to update auto-settle",
      autoSettleUnsupported:
        "This environment's server does not support turning auto-settle off per thread yet. Update the server to use it.",
      undoneAction: "settle",
      settledNotice: "Settled",
      settledSummary: (count: string) => `Settled ${count}`,
      keybinding: "Thread: Settle",
      settingsSection: "Auto-settle",
      autoSettleMergedTitle: "Auto-settle merged threads",
      autoSettleMergedDescription:
        "Settle a thread when its pull request merges. Closed pull requests still settle automatically.",
      autoSettleMergedReset: "auto-settle on merge",
      autoSettleInactiveTitle: "Auto-settle inactive threads",
      autoSettleInactiveDescription: (_days: number | null) =>
        "Sidebar threads with no activity for this long settle automatically.",
      autoSettleInactiveReset: "auto-settle",
      autoSettleDaysTitle: "Days of inactivity before auto-settle",
      autoSettleDaysDescription: "Any new activity un-settles a thread automatically.",
      autoSettleDaysLabel: "Days of inactivity before auto-settle",
      keepPullRequestsDescription:
        "Inactivity does not settle threads with a pull request. Merge and close still do.",
      deleteSettledWorktrees: "Delete settled worktrees",
      deleteSettledWorktreesDescription:
        "Remove worktrees this many days after their thread settles. Set 0 days to remove them at the next cleanup. Branches and thread history are kept.",
      scriptRunOnSettle: "Run in the thread's worktree when the thread settles",
      scriptStopOnSettle: "Stop this action when the thread settles",
      projectFoldersDescription:
        "Group sidebar threads into project folders. Pinned threads stay on top, and Snoozed and Settled stay below the folders.",
      searchKeywords: "",
    };
