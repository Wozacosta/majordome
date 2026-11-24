# Majordome's scenarios

> For maintainers. Scenarios are real-app runs of one behaviour, written as `*.e2e.ts` files under
> `scripts/scenarios` and run with `vp run scenarios`.

## Majordome's own screens

Scenarios named `majordome-*.e2e.ts` cover what Majordome adds: notes, chats and backup. Pass
`NOTES_FOLDER` from [`majordome.ts`](../../scripts/scenarios/majordome.ts) as the files of
`t3.project` to get a notes folder; a project is one when it holds a `.majordome` folder. They run
on every push to `main` (`majordome-scenarios.yml`), and a release waits for them.

The app under test runs with your real home folder. A scenario that makes the app write files
must give it a path under the folder `t3.project` returns, never a default that lands in the
home folder.

## Upstream's scenarios

[`scenarios.yml`](../../.github/workflows/scenarios.yml) runs upstream's web scenarios every night
through [`majordome.e2e.config.ts`](../../scripts/majordome.e2e.config.ts), which leaves out the
ones that stop at a control Majordome hides or renames. Run the same set with
`vp run scenarios --config majordome.e2e.config.ts --target web`. After a merge from upstream,
run it and add any new scenario that cannot pass on Majordome to that list.
