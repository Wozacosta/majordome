# Voice replies

Checks the one instruction the server appends to a turn whose answer is read aloud ([`spokenReply.ts`](../../apps/server/src/orchestration-v2/spokenReply.ts), sent when a message carries `replyStyle: "spoken"`, as the phone's voice mode does). A spoken case passes when the reply has no table, list, heading or code and is short enough to listen to; a control asks the same question without the flag and must still get its usual structured answer.

The model gets the user's words and the instruction exactly as a turn does, through `withReplyStyle` imported from source.

## Run

```sh
cd evals
pnpm voice-replies --out runs/check --case table-prone-question --samples 1
pnpm voice-replies --out runs/full
```

- Models go through the `claude` CLI, signed in to a Claude plan, so a run carries the provider's own instructions as a real chat does. Default model: `claude-haiku-5-5`. Pass `--model` once per model to change it.
- Flags: `--case <id>` (repeatable), `--samples <n>` (default 3), `--concurrency <n>` (default 3), `--baseline <results.ndjson>` to show an earlier run's pass counts beside this one's.
- A case fails when half or more of its samples fail. `summary.md` lists each failed sample's reasons; `results.ndjson` holds every reply.
- Cost: about 3 cents of plan usage for the four cases at three samples on Haiku.

## Add a case

Add an entry to `cases.ts`: what the user said, whether the turn is spoken, and the checks in `grade.ts` terms. `run.test.ts` tests the grader; extend it when you add a kind of check.

The first cases were written with the instruction. Without it the three spoken cases fail on Haiku and the control passes; a case added for a later fix must fail on the text it was written against.
