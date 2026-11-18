import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { majordomeVaultSlug } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  createVaultBundle,
  decryptFile,
  encryptFile,
  storeFolderBackup,
  validateBackupFolder,
} from "./vaultFolderBackup.ts";
import { gitIn, makeVault } from "./vaultTestRepos.ts";

const testLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-folder-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

// Low only to keep the test fast; real backups use age's default.
const scryptWorkFactor = 10;

it.layer(testLayer)("folder backup", (it) => {
  it.effect("writes an encrypted bundle that decrypts and clones back to the vault", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      const work = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-work-" });
      const folder = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-backups-" });
      yield* createVaultBundle({ cwd: root, bundlePath: `${work}/vault.bundle` });
      yield* encryptFile({
        source: `${work}/vault.bundle`,
        target: `${work}/vault.age`,
        passphrase: "correct horse « battery » staple",
        scryptWorkFactor,
      });

      const { file } = yield* storeFolderBackup({
        encryptedPath: `${work}/vault.age`,
        folder,
        slug: "brain",
        date: "2026-11-15",
        keep: 5,
      });

      assert.equal(file, `${folder}/majordome-brain-2026-11-15.age`);
      assert.deepStrictEqual(yield* fs.readDirectory(folder), ["majordome-brain-2026-11-15.age"]);
      const header = new TextDecoder().decode((yield* fs.readFile(file)).slice(0, 21));
      assert.equal(header, "age-encryption.org/v1");

      const wrong = yield* decryptFile({
        source: file,
        target: `${work}/wrong.bundle`,
        passphrase: "not it",
      }).pipe(Effect.flip);
      assert.equal(wrong._tag, "FolderBackupError");

      yield* decryptFile({
        source: file,
        target: `${work}/restored.bundle`,
        passphrase: "correct horse « battery » staple",
      });
      yield* gitIn(work, ["clone", "--quiet", `${work}/restored.bundle`, `${work}/restored`]);
      assert.equal(yield* fs.readFileString(`${work}/restored/memory.md`), "- Likes tea\n");
      assert.equal(
        yield* gitIn(`${work}/restored`, ["rev-parse", "HEAD"]),
        yield* gitIn(root, ["rev-parse", "HEAD"]),
      );
    }),
  );

  it.effect("keeps the newest copies of this vault and leaves other files alone", () =>
    Effect.gen(function* () {
      const { fs } = yield* makeVault();
      const work = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-work-" });
      const folder = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-backups-" });
      for (const day of ["01", "02", "03", "04"]) {
        yield* fs.writeFileString(`${folder}/majordome-brain-2026-10-${day}.age`, "old");
      }
      yield* fs.writeFileString(`${folder}/majordome-work-2026-10-01.age`, "another vault");
      yield* fs.writeFileString(`${folder}/holiday.jpg`, "not ours");
      yield* fs.writeFileString(`${work}/vault.age`, "encrypted");

      yield* storeFolderBackup({
        encryptedPath: `${work}/vault.age`,
        folder,
        slug: "brain",
        date: "2026-11-15",
        keep: 3,
      });

      assert.deepStrictEqual((yield* fs.readDirectory(folder)).toSorted(), [
        "holiday.jpg",
        "majordome-brain-2026-10-03.age",
        "majordome-brain-2026-10-04.age",
        "majordome-brain-2026-11-15.age",
        "majordome-work-2026-10-01.age",
      ]);
    }),
  );

  it.effect("accepts only an existing folder outside the vault", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      const folder = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-backups-" });
      const check = (path: string) =>
        validateBackupFolder({ folder: path, vaultRoot: root, homeDirectory: folder }).pipe(
          Effect.match({ onFailure: (error) => error.message, onSuccess: (value) => value }),
        );

      assert.equal(yield* check(folder), folder);
      assert.equal(yield* check("~"), folder);
      assert.include(yield* check(`${root}/backups`), "does not exist");
      yield* fs.makeDirectory(`${root}/backups`);
      assert.include(yield* check(`${root}/backups`), "outside your notes");
      assert.include(yield* check("relative/path"), "full path");
    }),
  );
});

it("names backups after the vault folder", () => {
  assert.equal(majordomeVaultSlug("My Brain"), "my-brain");
  assert.equal(majordomeVaultSlug("Café notes!"), "cafe-notes");
  assert.equal(majordomeVaultSlug("!!!"), "vault");
});
