// @effect-diagnostics nodeBuiltinImport:off globalDate:off - seeds an AI's session files and reads
// the app's database behind its back, outside the app's own services.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect } from "e2e";
import * as Effect from "effect/Effect";

import { T3_HOME } from "../e2e.config.ts";
import { NOTES_FOLDER } from "./majordome.ts";
import { runPromise, test, WEB } from "./t3.ts";

const STATE = NodePath.join(T3_HOME, "userdata");

/** The AI session each chat of a notes folder runs in, by the chat's title. */
function sessionsOf(workspace: string) {
  const database = new NodeSqlite.DatabaseSync(NodePath.join(STATE, "statev2.sqlite"), {
    readOnly: true,
  });
  try {
    const rows = database
      .prepare(
        `SELECT thread.title AS title, thread.thread_id AS threadId, thread.project_id AS projectId,
           json_extract(session.payload_json, '$.nativeThreadRef.nativeId') AS sessionId
         FROM orchestration_v2_projection_threads AS thread
         JOIN projection_projects AS project ON project.project_id = thread.project_id
         JOIN orchestration_v2_projection_provider_threads AS session
           ON session.thread_id = thread.thread_id
         WHERE project.workspace_root = ?
           AND json_extract(session.payload_json, '$.nativeThreadRef.nativeId') IS NOT NULL`,
      )
      .all(workspace) as unknown as ReadonlyArray<{
      title: string;
      threadId: string;
      projectId: string;
      sessionId: string;
    }>;
    return new Map(rows.map((row) => [row.title, row]));
  } finally {
    database.close();
  }
}

/** One answer in Claude's own session file format: what the usage page reads. */
const answer = (sessionId: string, id: string, outputTokens: number) =>
  `${JSON.stringify({
    type: "assistant",
    timestamp: new Date().toISOString(),
    requestId: `req_${id}`,
    sessionId,
    message: {
      id: `msg_${id}`,
      model: "claude-scenario",
      usage: { input_tokens: 0, output_tokens: outputTokens },
    },
  })}\n`;

test(
  "Usage is under More, and says what a routine, a topic and the other chats used",
  WEB,
  async ({ t3, app, screen }) => {
    const notes = await t3.project("Notes", {
      ...NOTES_FOLDER,
      ".majordome/topics.json": JSON.stringify({
        topics: [{ id: "money", title: "Money", folder: "money" }],
      }),
      "money/log.md": "# Money\n",
    });
    // The replay assistant records no usage, so the scenario writes the session files a real one
    // leaves and points the app's Claude at them. First, so the server has read its settings again
    // well before the page asks.
    const claudeHome = NodePath.join(NodePath.dirname(notes), "claude");
    const transcripts = NodePath.join(claudeHome, "projects", "scenario");
    await NodeFSP.mkdir(transcripts, { recursive: true });
    const settingsPath = NodePath.join(STATE, "settings.json");
    const settings = JSON.parse(await NodeFSP.readFile(settingsPath, "utf8")) as {
      providerInstances: Record<string, Record<string, unknown>>;
    };
    const claude = settings.providerInstances.claudeAgent;
    settings.providerInstances.claudeAgent = { ...claude, config: { homePath: claudeHome } };
    await NodeFSP.writeFile(settingsPath, JSON.stringify(settings));

    await t3.thread({ project: notes, title: "Money chat", messages: ["first"] });
    await t3.thread({ project: notes, title: "Loose chat", messages: ["first"] });

    await t3.open("/routines");
    await screen
      .getByRole("listitem")
      .filter({ hasText: "Open today's daily note" })
      .getByRole("button", "Run now")
      .tap();
    await expect(screen.getByRole("link", "Start my day, Done", { exact: false })).toBeVisible({
      timeout: 100_000,
    });

    // Under the sessions these chats ran in.
    // A run shows as done a moment before its session is on record.
    let sessions = sessionsOf(notes);
    for (let attempt = 0; attempt < 120 && !sessions.has("Start my day"); attempt += 1) {
      await runPromise(Effect.sleep("250 millis"));
      sessions = sessionsOf(notes);
    }
    const money = sessions.get("Money chat");
    const loose = sessions.get("Loose chat");
    const brief = sessions.get("Start my day");
    if (!money || !loose || !brief) throw new Error("A chat of the scenario has no session yet");
    await NodeFSP.writeFile(
      NodePath.join(transcripts, "sessions.jsonl"),
      answer(brief.sessionId, "brief", 2_500) +
        answer(money.sessionId, "money", 1_500) +
        answer(loose.sessionId, "loose", 700) +
        // The same AI used in a terminal: no chat of the app ran in this session.
        answer("a-terminal-session", "terminal", 900),
    );
    const topicsPath = NodePath.join(STATE, "majordome", "topics.json");
    const topics = JSON.parse(await NodeFSP.readFile(topicsPath, "utf8")) as {
      projects: Record<string, { threads: Record<string, string> }>;
    };
    topics.projects[money.projectId] = {
      ...topics.projects[money.projectId],
      threads: { money: money.threadId },
    };
    await NodeFSP.writeFile(topicsPath, JSON.stringify(topics));

    try {
      await t3.open("/");
      await screen.getByRole("button", "More", { exact: true }).tap();
      await screen.getByRole("link", "Usage", { exact: true }).tap();
      await expect(screen.getByRole("heading", "Breakdown")).toBeVisible({ timeout: 60_000 });

      await screen.getByRole("button", "Routine", { exact: true }).tap();
      const rows = screen.getByRole("row");
      await expect(rows.filter({ hasText: "Start my day" })).toContainText("2.50K", {
        timeout: 60_000,
      });
      // The two chats together, whichever topic they are in.
      await expect(rows.filter({ hasText: "Chats" })).toContainText("2.20K");
      await expect(rows.filter({ hasText: "Outside Majordome" })).toBeVisible();
      await app.screenshot("usage-by-routine");

      await screen.getByRole("button", "Topic", { exact: true }).tap();
      await expect(rows.filter({ hasText: "Money" })).toContainText("1.50K");
      await expect(rows.filter({ hasText: "Other chats" })).toContainText("700");
      await expect(rows.filter({ hasText: "Routines" })).toContainText("2.50K");
      await app.screenshot("usage-by-topic");
    } finally {
      // The server outlives the test: the next one gets the settings this one found.
      settings.providerInstances.claudeAgent = claude ?? {};
      await NodeFSP.writeFile(settingsPath, JSON.stringify(settings));
    }
  },
);
