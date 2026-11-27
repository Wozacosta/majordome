#!/usr/bin/env node
// An eval script, not server code: it runs the Claude CLI with Node's own modules.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  SPOKEN_REPLY_INSTRUCTIONS,
  withReplyStyle,
} from "../../apps/server/src/orchestration-v2/spokenReply.ts";
import { cases } from "./cases.ts";
import { grade } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
    concurrency: { type: "string", default: "3" },
    baseline: { type: "string" },
  },
});
if (!values.out) throw new Error("Use --out <directory> [--model <id>] [--case <id>].");
const outDirectory = values.out;
const models = values.model ?? ["claude-haiku-5-5"];
const selected = values.case ? cases.filter((entry) => values.case!.includes(entry.id)) : cases;
const samples = Number(values.samples);
const textHash = NodeCrypto.createHash("sha256")
  .update(SPOKEN_REPLY_INSTRUCTIONS)
  .digest("hex")
  .slice(0, 12);

interface Row {
  readonly case: string;
  readonly kind: string;
  readonly model: string;
  readonly sample: number;
  readonly pass: boolean;
  readonly failures: ReadonlyArray<string>;
  readonly reply: string;
  readonly costUsd: number;
}

// The CLI of a session that runs this script must not mistake the eval for its own child.
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^CLAUDE(CODE$|_)/.test(name)),
);

/** One turn in an empty folder, with the provider's own instructions, as a chat's turn has. */
const ask = (model: string, prompt: string) =>
  new Promise<{ readonly reply: string; readonly costUsd: number }>((resolve, reject) => {
    const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "voice-replies-"));
    const child = NodeChildProcess.execFile(
      "claude",
      ["-p", prompt, "--model", model, "--output-format", "json"],
      { cwd, env: environment, maxBuffer: 1 << 24, timeout: 180_000 },
      (error, stdout) => {
        NodeFS.rmSync(cwd, { recursive: true, force: true });
        if (error) return reject(error);
        try {
          const parsed = JSON.parse(stdout) as { result?: unknown; total_cost_usd?: unknown };
          resolve({
            reply: typeof parsed.result === "string" ? parsed.result : "",
            costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0,
          });
        } catch (cause) {
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      },
    );
    child.stdin?.end();
  });

const jobs = models.flatMap((model) =>
  selected.flatMap((entry) =>
    Array.from({ length: samples }, (_, sample) => ({ model, entry, sample })),
  ),
);
const rows: Array<Row> = [];
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const job = jobs[next++]!;
    const base = { case: job.entry.id, kind: job.entry.kind, model: job.model, sample: job.sample };
    try {
      const { reply, costUsd } = await ask(
        job.model,
        withReplyStyle(job.entry.text, job.entry.spoken ? "spoken" : undefined),
      );
      rows.push({ ...base, ...grade(reply, job.entry.checks), reply, costUsd });
    } catch (error) {
      rows.push({
        ...base,
        pass: false,
        failures: [`error: ${String(error)}`],
        reply: "",
        costUsd: 0,
      });
    }
  }
};
await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
rows.sort(
  (a, b) =>
    jobs.findIndex(
      (job) => job.entry.id === a.case && job.model === a.model && job.sample === a.sample,
    ) -
    jobs.findIndex(
      (job) => job.entry.id === b.case && job.model === b.model && job.sample === b.sample,
    ),
);

NodeFS.mkdirSync(outDirectory, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(outDirectory, "results.ndjson"),
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
);
const baseline: ReadonlyArray<Pick<Row, "case" | "model" | "pass">> = values.baseline
  ? NodeFS.readFileSync(values.baseline, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Row)
  : [];
const rate = (own: ReadonlyArray<{ readonly pass: boolean }>) =>
  own.length === 0 ? "-" : `${own.filter((row) => row.pass).length}/${own.length}`;

const lines = [
  `instruction ${textHash}, ${SPOKEN_REPLY_INSTRUCTIONS.split(/\s+/).filter(Boolean).length} words`,
  "",
  "| model | case | kind | passed | baseline | verdict |",
  "|---|---|---|---|---|---|",
];
for (const model of models) {
  for (const entry of selected) {
    const own = rows.filter((row) => row.model === model && row.case === entry.id);
    const passes = own.filter((row) => row.pass).length;
    // A case fails when half or more of its samples fail.
    const verdict = passes > own.length / 2 ? "pass" : "FAIL";
    const before = baseline.filter((row) => row.model === model && row.case === entry.id);
    lines.push(
      `| ${model} | ${entry.id} | ${entry.kind} | ${rate(own)} | ${rate(before)} | ${verdict} |`,
    );
    for (const row of own) {
      if (!row.pass) lines.push(`|  | sample ${row.sample}: ${row.failures.join("; ")} | | | | |`);
    }
  }
  const cost = rows.filter((row) => row.model === model).reduce((sum, row) => sum + row.costUsd, 0);
  lines.push(`| ${model} | $${cost.toFixed(3)} at list price | | | | |`);
}
const report = `${lines.join("\n")}\n`;
NodeFS.writeFileSync(NodePath.join(outDirectory, "summary.md"), report);
process.stdout.write(report);
