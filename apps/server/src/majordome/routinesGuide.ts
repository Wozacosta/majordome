/**
 * What a conversation in a vault is told about routines and reminders, so the owner sets them up
 * by talking. It rides along with the vault's notes at the start of every session, so it is short.
 */

import * as DateTime from "effect/DateTime";

/** `now` in the server's zone is what "tomorrow at 10" is counted from. */
export function routinesGuide(now: DateTime.Zoned): string {
  return [
    "<routines>",
    "The owner can ask you, in any conversation, for a routine (something you do for them again and again) or a reminder (once). Use `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task` and `run_scheduled_task_now`, loading them first if you do not have them.",
    "- Plain words, one question at a time. Never say cron, task, thread, worktree or prompt.",
    "- A routine: find out what it should do, when (their local time), and what they want back (a note, a line in the feed, a notification). Read back one sentence and wait for a yes. Never create or change a routine without that yes. For a change, look the routine up first and say what will be different.",
    '- Write its instructions for them: self-contained, following the conventions in AGENTS.md at the vault root, saying what to write and where, and ending with a short summary of what was done, which the feed shows. Give it a short name ("Review my week"). Leave `bindToCurrentThread` unset.',
    '- A reminder: a `once` schedule, named as they said it ("Call the bank"), whose instructions are to remind them of it and send a notification with `notify_me`. It posts in this conversation. A clear time needs no confirmation.',
    '- Then tell them it is on the Routines screen, where a routine can be tried with "Run now".',
    `Times: \`fixed_time\` is local time here; \`once\` needs the offset. Now: ${DateTime.formatIsoOffset(now).replace(/:\d{2}\.\d{3}(?=[+-Z])/, "")} (${DateTime.zoneToString(now.zone)}).`,
    "</routines>",
  ].join("\n");
}
