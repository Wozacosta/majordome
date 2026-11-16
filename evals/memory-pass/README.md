# Memory pass

Runs Majordome's nightly memory pass, the "Tidy my memory" routine ([`memoryPassPrompt.ts`](../../apps/server/src/majordome/memoryPassPrompt.ts)), on small fixture vaults and checks what the vault looks like afterwards: durable facts kept with a date and a link, passing remarks left out, secrets never copied, `CLAUDE.md` and the owner's daily notes untouched, and an over-limit memory note made shorter without losing its newest facts.

The model gets what a real run gets as its first message: the vault context the server builds (`readVaultContext`, with the pass's list of changed notes) and the routine's prompt, both imported from source. It works on a throwaway copy of the vault with `list_files`, `read_file`, `write_file` and `edit_file`. The system prompt is a stand-in for a provider's own, and there is no shell, as the prompt promises none is needed.

## Run

```sh
cd evals
pnpm memory-pass --out runs/check --dry-run
pnpm memory-pass --out runs/baseline --case facts-remark-secret --samples 1
pnpm memory-pass --out runs/full
```

- `--dry-run` calls no model. It writes each case's first message to `--out` so you can read exactly what the model would see.
- Models go through the `vibeproxy` CLIProxyAPI provider in `~/.codex/config.toml`. Default models: `gpt-6.1-terra` and `gpt-6-luna`. Pass `--model` once per model to change them.
- Flags: `--case <id>` (repeatable), `--samples <n>` (default 3), `--concurrency <n>` (default 4), `--reasoning <level>` (default `low`), `--baseline <results.ndjson>` to show an earlier run's pass counts beside this one's.
- A case fails when half or more of its samples fail. `summary.md` lists each failed sample's reasons; `results.ndjson` holds every sample's final reply and vault.
- Cost: proxy quota only. A sample is a short tool loop over a vault of a few kilobytes.

## Add a case

Add an entry to `cases.ts`: the vault's files, the notes the pass is told changed, and the checks in `grade.ts` terms. Use made-up people and numbers. Add a control when a change could make the pass write more than it should. `run.test.ts` tests the grader against hand-written outcomes; extend it when you add a kind of check.

The first cases were written with the prompt, so they have no failing baseline; a case added for a later fix must fail on the text it was written against.
