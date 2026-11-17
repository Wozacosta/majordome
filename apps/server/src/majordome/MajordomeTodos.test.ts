import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as MajordomeTodos from "./MajordomeTodos.ts";
import * as VaultLock from "./VaultLock.ts";

const vaultProject = ProjectId.make("vault-project");
const codeProject = ProjectId.make("code-project");

const setUp = Effect.fn("test.setUp")(function* (
  files: Readonly<Record<string, string>>,
  config = "{}",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vault = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-todos-vault-" });
  const code = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-todos-code-" });
  const write = (relativePath: string, text: string) =>
    fs
      .makeDirectory(path.dirname(path.join(vault, relativePath)), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path.join(vault, relativePath), text)));
  yield* write(".majordome/config.json", config);
  for (const [relativePath, text] of Object.entries(files)) yield* write(relativePath, text);
  const roots: Record<string, string> = { [vaultProject]: vault, [codeProject]: code };
  const service = yield* Effect.service(MajordomeTodos.MajordomeTodos).pipe(
    Effect.provide(
      MajordomeTodos.layer.pipe(
        Layer.provide(VaultLock.layer),
        Layer.provide(
          Layer.mock(ProjectStore.ProjectStoreV2)({
            get: (projectId) =>
              Effect.succeed(
                roots[projectId] === undefined
                  ? Option.none()
                  : Option.some({ workspaceRoot: roots[projectId] } as ProjectStore.ProjectRow),
              ),
          }),
        ),
      ),
    ),
  );
  const read = (relativePath: string) => fs.readFileString(path.join(vault, relativePath));
  return { service, vault, code, fs, path, read };
});

const errorMessage = <A, E extends { readonly message: string }>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? Option.match(Exit.findErrorOption(exit), { onNone: () => "", onSome: (e) => e.message })
    : "";

it.layer(NodeServices.layer)("MajordomeTodos", (it) => {
  it.effect("is empty for a project that is not a vault", () =>
    Effect.gen(function* () {
      const { service } = yield* setUp({});
      assert.deepEqual(yield* service.list({ projectId: codeProject }), {
        isVault: false,
        notes: [],
        totalOpen: 0,
        totalNotes: 0,
      });
    }),
  );

  it.effect("lists the unticked checkboxes of the notes, newest note first", () =>
    Effect.gen(function* () {
      const { service, vault, fs, path } = yield* setUp({
        "projects/house.md": [
          "# House",
          "- [ ] Call the plumber",
          "  * [ ] Ask for a quote  ",
          "\t+ [ ] Measure the window",
          "- [x] Sign the lease",
          "- [X] Pay the deposit",
          "- [ ]",
          "-[ ] no space after the dash",
          "```md",
          "- [ ] inside a code block",
          "```",
          "~~~",
          "- [ ] inside a tilde block",
          "~~~",
          "- [ ] After the code",
        ].join("\n"),
        "daily/2026-11-15.md": "- [ ] Buy bread\n",
        "done.md": "- [x] All done\n",
        "Archive/old.md": "- [ ] In the archive\n",
        "projects/archive/kept.md": "- [ ] In a nested archive folder\n",
        ".obsidian/plugin.md": "- [ ] Hidden\n",
        ".majordome/notes.md": "- [ ] Plumbing\n",
        "data.json": "- [ ] Not a note\n",
      });
      yield* fs.utimes(path.join(vault, "projects/house.md"), 1_000, 1_000);
      yield* fs.utimes(path.join(vault, "projects/archive/kept.md"), 2_000, 2_000);
      yield* fs.utimes(path.join(vault, "daily/2026-11-15.md"), 3_000, 3_000);

      const result = yield* service.list({ projectId: vaultProject });
      assert.deepEqual(result, {
        isVault: true,
        notes: [
          {
            path: "daily/2026-11-15.md",
            title: "2026-11-15",
            modifiedAt: "1970-01-01T00:50:00.000Z",
            todos: [{ line: 1, text: "Buy bread" }],
            more: 0,
          },
          {
            path: "projects/archive/kept.md",
            title: "kept",
            modifiedAt: "1970-01-01T00:33:20.000Z",
            todos: [{ line: 1, text: "In a nested archive folder" }],
            more: 0,
          },
          {
            path: "projects/house.md",
            title: "House",
            modifiedAt: "1970-01-01T00:16:40.000Z",
            todos: [
              { line: 2, text: "Call the plumber" },
              { line: 3, text: "Ask for a quote" },
              { line: 4, text: "Measure the window" },
              { line: 15, text: "After the code" },
            ],
            more: 0,
          },
        ],
        totalOpen: 6,
        totalNotes: 3,
      });
    }),
  );

  it.effect("caps the notes and each note's to-dos, and still counts them all", () =>
    Effect.gen(function* () {
      const files: Record<string, string> = {
        "long.md": Array.from({ length: 23 }, (_, index) => `- [ ] Item ${index + 1}`).join("\n"),
      };
      for (let index = 0; index < 52; index++) files[`notes/n${index}.md`] = "- [ ] One\n";
      const { service, vault, fs, path } = yield* setUp(files);
      yield* fs.utimes(path.join(vault, "long.md"), 4_000_000_000, 4_000_000_000);

      const result = yield* service.list({ projectId: vaultProject });
      assert.equal(result.totalNotes, 53);
      assert.equal(result.totalOpen, 75);
      assert.equal(result.notes.length, 50);
      assert.equal(result.notes[0]?.path, "long.md");
      assert.equal(result.notes[0]?.todos.length, 20);
      assert.equal(result.notes[0]?.more, 3);
    }),
  );

  it.effect("ticks and unticks one box and leaves every other byte alone", () =>
    Effect.gen(function* () {
      const text = "﻿# Trip\r\n\r\n- [ ] Réserver l'hôtel\r\n  * [ ] Book the train\r\n- [x] Pack";
      const { service, vault, fs, path } = yield* setUp({ "trip.md": text });
      const onDisk = fs
        .readFile(path.join(vault, "trip.md"))
        .pipe(Effect.map((bytes) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)));
      const target = { projectId: vaultProject, path: "trip.md", line: 4, text: "Book the train" };

      yield* service.setDone({ ...target, done: true });
      assert.equal(yield* onDisk, text.replace("* [ ] Book", "* [x] Book"));
      assert.deepEqual((yield* service.list({ projectId: vaultProject })).notes[0]?.todos, [
        { line: 3, text: "Réserver l'hôtel" },
      ]);

      yield* service.setDone({ ...target, done: false });
      yield* service.setDone({ ...target, line: 3, text: "Réserver l'hôtel", done: true });
      assert.equal(yield* onDisk, text.replace("- [ ] Réserver", "- [x] Réserver"));
    }),
  );

  it.effect("refuses a line that no longer reads as it was listed", () =>
    Effect.gen(function* () {
      const text = "- [ ] Call the bank\n- [ ] Buy bread\n";
      const { service, read } = yield* setUp({ "list.md": text });
      for (const stale of [
        { path: "list.md", line: 1, text: "Buy bread" },
        { path: "list.md", line: 3, text: "Buy bread" },
        { path: "list.md", line: 9, text: "Buy bread" },
        { path: "gone.md", line: 1, text: "Call the bank" },
      ]) {
        const exit = yield* Effect.exit(
          service.setDone({ projectId: vaultProject, done: true, ...stale }),
        );
        assert.equal(errorMessage(exit), "That note changed. Refresh and try again.");
      }
      assert.equal(yield* read("list.md"), text);
    }),
  );

  it.effect("refuses a path that leaves the notes folder or names its plumbing", () =>
    Effect.gen(function* () {
      const { service, vault, code, fs, path } = yield* setUp({
        ".majordome/hidden.md": "- [ ] Plumbing\n",
      });
      const outside = path.join(code, "outside.md");
      yield* fs.writeFileString(outside, "- [ ] Outside\n");
      yield* fs.symlink(outside, path.join(vault, "link.md"));
      for (const [notePath, text] of [
        [`../${path.basename(code)}/outside.md`, "Outside"],
        [outside, "Outside"],
        ["link.md", "Outside"],
        [".majordome/hidden.md", "Plumbing"],
      ] as const) {
        const exit = yield* Effect.exit(
          service.setDone({ projectId: vaultProject, path: notePath, line: 1, text, done: true }),
        );
        assert.equal(errorMessage(exit), "That note is not in your notes folder.", notePath);
      }
      assert.equal(yield* fs.readFileString(outside), "- [ ] Outside\n");
    }),
  );

  it.effect("adds a to-do to To-dos.md in the inbox folder, creating it when missing", () =>
    Effect.gen(function* () {
      const { service, read } = yield* setUp({});
      yield* service.add({ projectId: vaultProject, text: "  Call the bank  " });
      assert.equal(yield* read("inbox/To-dos.md"), "# To-dos\n\n- [ ] Call the bank\n");
      yield* service.add({ projectId: vaultProject, text: "Buy bread" });
      assert.equal(
        yield* read("inbox/To-dos.md"),
        "# To-dos\n\n- [ ] Call the bank\n- [ ] Buy bread\n",
      );

      for (const [text, message] of [
        ["   ", "Write what there is to do first."],
        ["one\ntwo", "Keep a to-do on one line."],
      ] as const) {
        const exit = yield* Effect.exit(service.add({ projectId: vaultProject, text }));
        assert.equal(errorMessage(exit), message);
      }
      const notVault = yield* Effect.exit(service.add({ projectId: codeProject, text: "x" }));
      assert.equal(errorMessage(notVault), "That notes folder was not found.");
    }),
  );

  it.effect("appends on a new line in the vault's own inbox folder", () =>
    Effect.gen(function* () {
      const { service, read } = yield* setUp(
        { "in/To-dos.md": "- [x] Old one" },
        JSON.stringify({ folders: { inbox: "in" } }),
      );
      yield* service.add({ projectId: vaultProject, text: "New one" });
      assert.equal(yield* read("in/To-dos.md"), "- [x] Old one\n- [ ] New one\n");
    }),
  );
});
