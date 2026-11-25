// Majordome only. Upstream's scenarios, less the ones that cannot pass on Majordome's screens.
// scenarios.yml runs this every night. See docs/operations/majordome-scenarios.md.
import type { E2EConfig } from "e2e";

import upstream from "./e2e.config.ts";

// Each scenario here stops at a control Majordome hides or names differently, named by its key.
// Listed here, not skipped in the scenario's own file, so a merge from upstream never conflicts.
const NOT_ON_MAJORDOME = {
  "the terminal drawer": [
    "idle-terminal-label-follows-language",
    "pending-terminal-input-follows-language-change",
    "terminal-bare-filename-opens-its-location",
    "terminal-closed-elsewhere-leaves-drawer",
    "terminal-drags-tmux-pane-divider",
    "terminal-file-uri-opens-its-exact-file",
    "terminal-hostname-file-link-opens-its-file",
    "terminal-large-paste-reaches-program",
    "terminal-numlock-off-keypad-navigates",
    "terminal-paste-keeps-input-from-other-client-out",
    "terminal-program-background-repaints-screen",
    "terminal-query-after-viewer-closes",
    "terminal-reports-focus-while-enabled",
    "terminal-shows-startup-failure",
  ],
  "git actions and the branch picker": [
    "branch-picker-sees-external-worktree",
    "failed-commit-message-stays-in-its-repository",
    "pull-request-checkout-error-follows-reference",
    "stopped-worktree-turn-sends-in-checkout",
    "unborn-commit-dialog-shows-net-counts",
    "utf16-merge-conflict-blocks-commit",
  ],
  "the Issues page, which is To-dos": [
    "issue-link-picker-finds-accented-thread",
    "issues-failed-refresh-keeps-loaded-comments",
    "issues-invalid-host-keeps-page",
    "issues-refresh-discards-pending-older-comments",
    "issues-refresh-reads-new-azure-state",
    "issues-shortcut-toggles-right-panel",
    "issues-shows-failed-refresh",
    "long-search-keeps-whole-characters",
  ],
  "Add environment, which is Add a computer": [
    "github-closing-pr-after-first-page",
    "issues-retry-keeps-pending-environment",
    "machine-switch-keeps-selected-models",
    "mention-finds-older-linked-thread",
    "removed-environment-closes-its-toasts",
    "removing-environment-clears-permission-notice",
  ],
  "thread wording, which is chat": [
    "archive-lists-thread-archived-elsewhere",
    "find-reveals-clipped-table-cell",
    "fork-title-regenerates-from-inherited-history",
    "thread-find-matches-dotted-capital-i",
    "thread-find-matches-file-line-range",
    "thread-find-paint-bound",
    "thread-search-finds-accented-message",
    "thread-search-finds-curly-apostrophe",
    "title-failure-keeps-whole-characters",
  ],
  "projects and their sidebar rows": [
    "add-project-tab-reaches-submit",
    "add-project-takes-the-draft",
    "browser-search-engine-read-only-in-project",
    "discarded-thread-draft-stays-discarded",
    "first-send-keeps-sidebar-scroll",
    "held-scheduled-occurrence",
    "labs-boring-sidebar-read-only-in-project",
    "project-action-draft-survives-failed-import",
    "renamed-fork-keeps-its-name",
    "scratch-folder-follows-language",
    "thread-find-large-row",
  ],
  "the file picker": [
    "file-picker-keeps-newer-file",
    "html-report-in-dot-folder",
    "notebook-shows-saved-output-in-tall-preview",
    "notebook-shows-visible-saved-output",
    "odt-preview-expands-repeated-table-cells",
    "rtf-preview-decodes-gb18030",
    "rtf-preview-keeps-named-text-characters",
    "xlsx-rapid-arrow-keys-advance-both-sheets",
  ],
  "work log rows": [
    "acp-location-only-update-names-edited-file",
    "command-output-keeps-literal-json",
    "hermes-wrapper-keeps-background-reply",
    "home-path-tool-rows-show-as-written",
    "pending-read-image-shows-loading-frame",
  ],
  "the side panel button, which is Show or hide the side panel": [
    "browser-history-keeps-visits-from-both-tabs",
    "expanding-visible-diffs-keeps-hidden-tests-folded",
    "ident-diff-expands-unchanged-lines",
    "ods-time-cell-shows-its-value",
    "panel-conditioned-enter-still-sends",
    "reopening-browser-keeps-the-newer-thread",
    "saved-file-shows-external-edit",
    "server-preview-app-link-stops-loading",
    "side-panel-preserves-reading-position",
  ],
  "the model picker, which is the three levels": [
    "acp-refused-model-keeps-native-session",
    "caret-onto-trigger-leaves-keys-with-text",
    "queued-edit-uses-selected-model",
  ],
  // Not Majordome's doing: upstream moved image compression into a worker (c3aacf1e5b), and
  // these still wait for it on the page.
  "upstream's image compression hook": [
    "enter-during-image-compression-sends-after",
    "overlapping-image-pastes-keep-order",
    "stopped-question-keeps-preparing-image",
  ],
  // These pass on a Mac and time out on the runner (2026-11-25); why is not known yet.
  "slow on the runner": [
    "linked-thread-retry-reads-again",
    "pull-request-search-keeps-whole-characters",
    "short-window-file-suggestions-reach-last-file",
  ],
  // Not Majordome's doing: its first attempt on a fresh app times out, here and on the runner.
  "a flaky first attempt": ["browser-tab-follows-page-title"],
  "one control each": [
    "agent-browser-devtools-port-not-a-server",
    "cleanup-skips-dangling-log-symlink",
    "pairing-completion-keeps-reopened-dialog",
    "pi-catalog-gap-keeps-chosen-model",
    "replay-turn-streams",
    "restored-settings-directory-stays-live",
    "webhook-log-keeps-whole-emoji",
  ],
};

export default {
  ...upstream,
  tests: [
    "scenarios/**/*.e2e.ts",
    ...Object.values(NOT_ON_MAJORDOME)
      .flat()
      .map((name) => `!scenarios/${name}.e2e.ts`),
  ],
} satisfies E2EConfig;
