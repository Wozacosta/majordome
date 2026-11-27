#!/usr/bin/env node
// An eval script, not server code: it builds throwaway vaults on disk with Node's own modules.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { memoryPassPrompt } from "../../apps/server/src/majordome/memoryPassPrompt.ts";
import { writeMemoryPassState } from "../../apps/server/src/majordome/memoryPassState.ts";
import { readVaultContext } from "../../apps/server/src/majordome/vaultContext.ts";
import { withInlineContext } from "../../apps/server/src/orchestration-v2/ContextHandoffDelivery.ts";
import { proxyConfig } from "../shared/proxy.ts";
import { cases, NOW, type Case } from "./cases.ts";
import { grade, type Files } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
    concurrency: { type: "string", default: "4" },
    reasoning: { type: "string", default: "low" },
    baseline: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.out) throw new Error("Use --out <directory> [--model <id>] [--case <id>] [--dry-run].");
const outDirectory = values.out;
const models = values.model ?? ["gpt-6.1-terra", "gpt-6-luna"];
const selected = values.case ? cases.filter((entry) => values.case!.includes(entry.id)) : cases;
const prompt = memoryPassPrompt({ memory: "memory.md", me: "me.md", dailyFolder: "daily" });
const promptHash = NodeCrypto.createHash("sha256").update(prompt).digest("hex").slice(0, 12);
// The fixture's small hours in whatever zone the eval runs in, as the server names daily notes.
const now = DateTime.makeZonedUnsafe(NOW, {
  timeZone: DateTime.zoneMakeLocal(),
  adjustForTimeZone: true,
});
const nowMillis = DateTime.toEpochMillis(now);
const projectId = "eval-vault";
const taskId = `majordome:${projectId}:tidy-my-memory`;

const readFiles = (root: string, folder = ""): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const entry of NodeFS.readdirSync(NodePath.join(root, folder), { withFileTypes: true })) {
    const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(files, readFiles(root, relative));
    else files[relative] = NodeFS.readFileSync(NodePath.join(root, relative), "utf8");
  }
  return files;
};

/** The case's vault on disk, and the first message a run gets: the vault context, then the prompt. */
const world = Effect.fn("evaluateMemoryPass.world")(function* (entry: Case) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "majordome-memory-pass-"));
  const vaultRoot = NodePath.join(root, "vault");
  const stateDir = NodePath.join(root, "state");
  for (const [file, contents] of Object.entries(entry.files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(vaultRoot, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(vaultRoot, file), contents);
  }
  yield* writeMemoryPassState(
    { stateDir, projectId },
    {
      head: "",
      brief: {
        since: DateTime.formatIso(DateTime.subtract(now, { days: 1 })),
        preparedAt: DateTime.formatIso(now),
        files: entry.changed,
        more: 0,
        memoryChars: (entry.files["memory.md"] ?? "").trim().length,
      },
    },
  );
  const context = yield* readVaultContext({
    vaultRoot,
    nowMillis,
    startedBy: { projectId, scheduledTaskId: taskId, stateDir },
  });
  return { root, vaultRoot, message: withInlineContext(context, prompt) };
});

const tools = [
  {
    type: "function",
    name: "list_files",
    description: "List every file in the vault, or in one folder of it.",
    parameters: { type: "object", properties: { folder: { type: "string" } } },
  },
  {
    type: "function",
    name: "read_file",
    description: "Read a file in the vault.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    type: "function",
    name: "write_file",
    description: "Create a file in the vault, or replace its whole contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, contents: { type: "string" } },
      required: ["path", "contents"],
    },
  },
  {
    type: "function",
    name: "edit_file",
    description: "Replace one exact piece of text in a file with another.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
];

/** A stand-in for a provider's own instructions, which this eval does not have. */
const system = (vaultRoot: string) =>
  [
    `You are an assistant working in the user's notes vault at ${vaultRoot}.`,
    "Read and edit its files with the tools; paths are relative to the vault. You have no shell.",
    `It is ${NOW.replace("T", " ")}.`,
  ].join("\n");

const runTool = (vaultRoot: string, name: string, args: Record<string, unknown>): string => {
  const relative = String(args.path ?? args.folder ?? "");
  const target = NodePath.resolve(vaultRoot, relative);
  if (target !== vaultRoot && !target.startsWith(`${vaultRoot}${NodePath.sep}`)) {
    return "That path is outside the vault.";
  }
  if (name === "list_files") {
    if (!NodeFS.existsSync(target)) return "No such folder.";
    const files = Object.keys(readFiles(vaultRoot)).filter(
      (file) => relative === "" || file.startsWith(`${relative.replace(/\/+$/, "")}/`),
    );
    return files.join("\n") || "No files.";
  }
  if (name === "read_file") {
    return NodeFS.existsSync(target) && NodeFS.statSync(target).isFile()
      ? NodeFS.readFileSync(target, "utf8")
      : "File not found.";
  }
  if (name === "write_file") {
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, String(args.contents ?? ""));
    return "Saved.";
  }
  if (name === "edit_file") {
    if (!NodeFS.existsSync(target)) return "File not found.";
    const text = NodeFS.readFileSync(target, "utf8");
    const oldText = String(args.old_text ?? "");
    if (oldText === "" || text.split(oldText).length !== 2) {
      return "old_text must appear exactly once in the file.";
    }
    NodeFS.writeFileSync(
      target,
      text.replace(oldText, () => String(args.new_text ?? "")),
    );
    return "Saved.";
  }
  return "Unknown tool.";
};

const decodeResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      output: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      usage: Schema.optional(Schema.Struct({ total_tokens: Schema.optional(Schema.Number) })),
    }),
  ),
);
const decodeArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const encodeRow = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeBaselineRow = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      case: Schema.String,
      model: Schema.String,
      pass: Schema.optional(Schema.Boolean),
    }),
  ),
);

const sample = Effect.fn("evaluateMemoryPass.sample")(function* (
  entry: Case,
  model: string,
  proxy: ReturnType<typeof proxyConfig>,
) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      schedule: Schedule.exponential("2 seconds"),
      times: 4,
    }),
  );
  const { root, vaultRoot, message } = yield* world(entry);
  const before: Files = readFiles(vaultRoot);
  const input: Array<unknown> = [{ role: "user", content: message }];
  let reply = "";
  let tokens = 0;
  for (let step = 0; step < 40; step++) {
    const response = yield* HttpClientRequest.post(`${proxy.url}/responses`).pipe(
      HttpClientRequest.setHeaders(proxy.headers),
      HttpClientRequest.bodyJson({
        model,
        instructions: system(vaultRoot),
        input,
        tools,
        reasoning: { effort: values.reasoning },
        store: false,
        include: ["reasoning.encrypted_content"],
      }),
      Effect.flatMap(client.execute),
    );
    const text = yield* response.text;
    if (response.status !== 200) {
      return yield* Effect.die(new Error(`Model API ${response.status}: ${text}`));
    }
    const decoded = decodeResponse(text);
    tokens += decoded.usage?.total_tokens ?? 0;
    input.push(...decoded.output);
    reply = decoded.output
      .filter((item) => item.type === "message")
      .flatMap((item) => (item.content as Array<{ text?: string }>).map((part) => part.text ?? ""))
      .join("");
    const calls = decoded.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) break;
    for (const call of calls) {
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: runTool(vaultRoot, String(call.name), decodeArguments(String(call.arguments))),
      });
    }
  }
  const after: Files = readFiles(vaultRoot);
  NodeFS.rmSync(root, { recursive: true });
  return { ...grade({ before, after, reply, checks: entry.checks }), reply, after, tokens };
});

const sampleSafely = (
  entry: Case,
  model: string,
  index: number,
  proxy: ReturnType<typeof proxyConfig>,
) =>
  sample(entry, model, proxy).pipe(
    Effect.map((result) => ({ case: entry.id, kind: entry.kind, model, sample: index, ...result })),
    Effect.catchCause((cause) =>
      Effect.succeed({
        case: entry.id,
        kind: entry.kind,
        model,
        sample: index,
        error: String(cause),
      }),
    ),
  );

const dryRun = Effect.gen(function* () {
  NodeFS.mkdirSync(outDirectory, { recursive: true });
  const lines = [`prompt ${promptHash}, ${prompt.split(/\s+/).length} words, no model was called`];
  for (const entry of selected) {
    const { root, message } = yield* world(entry);
    NodeFS.rmSync(root, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(outDirectory, `${entry.id}.input.md`), message);
    lines.push(`${entry.id} (${entry.kind}): ${message.length} characters of input`);
  }
  return `${lines.join("\n")}\n`;
});

const run = Effect.gen(function* () {
  NodeFS.mkdirSync(outDirectory, { recursive: true });
  const proxy = proxyConfig();
  const samples = Number(values.samples);
  const rows = yield* Effect.forEach(
    models.flatMap((model) =>
      selected.flatMap((entry) =>
        Array.from({ length: samples }, (_, index) => ({ model, entry, index })),
      ),
    ),
    ({ model, entry, index }) => sampleSafely(entry, model, index, proxy),
    { concurrency: Number(values.concurrency) },
  );
  NodeFS.writeFileSync(
    NodePath.join(outDirectory, "results.ndjson"),
    `${rows.map((row) => encodeRow(row)).join("\n")}\n`,
  );
  const baseline = values.baseline
    ? NodeFS.readFileSync(values.baseline, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => decodeBaselineRow(line))
    : [];
  const rate = (own: ReadonlyArray<{ readonly pass?: boolean | undefined }>) =>
    own.length === 0 ? "-" : `${own.filter((row) => row.pass === true).length}/${own.length}`;

  const lines = [
    `prompt ${promptHash}, ${prompt.split(/\s+/).length} words`,
    "",
    "| model | case | kind | passed | baseline | verdict |",
    "|---|---|---|---|---|---|",
  ];
  for (const model of models) {
    for (const entry of selected) {
      const own = rows.filter((row) => row.model === model && row.case === entry.id);
      const passes = own.filter((row) => "pass" in row && row.pass).length;
      // A case fails when half or more of its samples fail; a run error counts as a failure.
      const verdict = passes > own.length / 2 ? "pass" : "FAIL";
      const before = baseline.filter((row) => row.model === model && row.case === entry.id);
      lines.push(
        `| ${model} | ${entry.id} | ${entry.kind} | ${passes}/${own.length} | ${rate(before)} | ${verdict} |`,
      );
      for (const row of own) {
        if ("error" in row) lines.push(`|  | sample ${row.sample}: ${row.error} | | | | |`);
        else if (!row.pass)
          lines.push(`|  | sample ${row.sample}: ${row.failures.join("; ")} | | | | |`);
      }
    }
    const tokens = rows
      .filter((row) => row.model === model)
      .reduce((sum, row) => sum + ("tokens" in row ? row.tokens : 0), 0);
    lines.push(`| ${model} | ${tokens} tokens | | | | |`);
  }
  const report = `${lines.join("\n")}\n`;
  NodeFS.writeFileSync(NodePath.join(outDirectory, "summary.md"), report);
  return report;
});

process.stdout.write(
  await Effect.runPromise(
    (values["dry-run"] ? dryRun : run).pipe(
      Effect.provide(Layer.merge(FetchHttpClient.layer, NodeServices.layer)),
    ),
  ),
);
