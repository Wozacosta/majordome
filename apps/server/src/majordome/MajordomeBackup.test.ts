import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as BackupPassphraseStore from "./BackupPassphraseStore.ts";
import * as MajordomeBackup from "./MajordomeBackup.ts";
import { commitVaultRun } from "./VaultCommitReactor.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import { decryptFile } from "./vaultFolderBackup.ts";
import * as VaultLock from "./VaultLock.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import {
  cloneElsewhere,
  commitAll,
  FAKE_GITHUB_TOKEN,
  gitIn,
  makeVault,
  remoteMain,
} from "./vaultTestRepos.ts";

const testLayer = Layer.mergeAll(
  GitVcsDriver.layer,
  ProcessRunner.layer,
  VaultLock.layer,
  VaultActiveRuns.layerIdle,
  Layer.effect(
    BackupPassphraseStore.BackupPassphraseStore,
    BackupPassphraseStore.makeSecretStore(),
  ),
  // Nothing here may reach GitHub.
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("no network in tests")),
  ),
).pipe(
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-backup-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const projectId = ProjectId.make("vault-project");

/** The backup service over one vault project, encrypting with a low work factor for speed. */
const backupFor = (root: string) =>
  MajordomeBackup.make({ scryptWorkFactor: 10 }).pipe(
    Effect.provideService(ProjectStore.ProjectStoreV2, {
      get: () => Effect.succeedSome({ projectId, workspaceRoot: root }),
      list: () => Effect.succeed([{ projectId, workspaceRoot: root }]),
    } as unknown as ProjectStore.ProjectStoreV2["Service"]),
  );

const lastCommit = (root: string) => gitIn(root, ["log", "-1", "--format=%an|%s"]);

it.layer(testLayer)("MajordomeBackup", (it) => {
  it.effect(
    "saves the owner's edits, sends them to the remote and reports the vault backed up",
    () =>
      Effect.gen(function* () {
        const { root, bare, fs } = yield* makeVault({ remote: true });
        const backup = yield* backupFor(root);
        yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n- Walks at noon\n");

        yield* backup.runCycle(root);

        assert.equal(yield* lastCommit(root), "Owner|Your edits");
        assert.equal(yield* remoteMain(bare!), yield* gitIn(root, ["rev-parse", "HEAD"]));
        const status = yield* backup.getStatus({ projectId });
        assert.isNotNull(status.lastSavedAt);
        assert.isNull(status.paused);
        assert.deepInclude(status.remote, {
          name: "origin",
          host: null,
          isGitHub: false,
          syncing: true,
          backedUp: true,
          lastError: null,
        });
      }),
  );

  it.effect("waits for the vault's lock, so a run's commit never mixes with the owner's", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault();
      const backup = yield* backupFor(root);
      const lock = yield* VaultLock.VaultLock;

      yield* lock
        .withLock(
          root,
          Effect.gen(function* () {
            const saving = yield* Effect.forkChild(backup.runCycle(root));
            // The agent's run writes and commits while the autosave waits for the lock.
            yield* fs.writeFileString(`${root}/plan.md`, "- Written by the agent\n");
            yield* commitVaultRun({ cwd: root, message: "majordome: Plan the week" });
            return saving;
          }),
        )
        .pipe(Effect.flatMap(Fiber.join));

      assert.equal(yield* lastCommit(root), "Majordome|majordome: Plan the week");
      assert.equal(yield* gitIn(root, ["rev-list", "--count", "HEAD"]), "2");
    }),
  );

  it.effect("pauses saving on a possible secret and saves again once it is gone", () =>
    Effect.gen(function* () {
      // gitleaks is part of the dev setup; without it there is no scan to test.
      if ((yield* findGitleaks()) === null) return;
      const { root, fs } = yield* makeVault();
      const backup = yield* backupFor(root);
      yield* fs.writeFileString(`${root}/memory.md`, `- token: ${FAKE_GITHUB_TOKEN}\n`);

      yield* backup.runCycle(root);
      const paused = yield* backup.getStatus({ projectId });
      assert.deepInclude(paused.paused, { reason: "secret", files: ["memory.md"] });
      assert.equal(yield* lastCommit(root), "Owner|init");

      yield* fs.writeFileString(`${root}/memory.md`, "- token kept in my password manager\n");
      yield* backup.runCycle(root);
      assert.isNull((yield* backup.getStatus({ projectId })).paused);
      assert.equal(yield* lastCommit(root), "Owner|Your edits");
    }),
  );

  it.effect("keeps saving but pauses syncing when the notes changed in two places", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const backup = yield* backupFor(root);
      const elsewhere = yield* cloneElsewhere(bare!);
      yield* fs.writeFileString(`${elsewhere}/memory.md`, "- Likes coffee\n");
      yield* commitAll(elsewhere, "Your edits");
      yield* gitIn(elsewhere, ["push", "--quiet"]);
      const remoteHead = yield* remoteMain(bare!);
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes green tea\n");

      yield* backup.runCycle(root);

      assert.equal(yield* lastCommit(root), "Owner|Your edits");
      assert.equal(yield* remoteMain(bare!), remoteHead);
      const status = yield* backup.getStatus({ projectId });
      assert.deepInclude(status.paused, { reason: "conflict", files: ["memory.md"] });
      assert.isFalse(status.remote?.backedUp);
    }),
  );

  it.effect(
    "backs up to a folder right away, and forgets the folder and passphrase on request",
    () =>
      Effect.gen(function* () {
        const { root, fs } = yield* makeVault();
        const backup = yield* backupFor(root);
        const folder = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-backups-" });
        const passphrases = yield* BackupPassphraseStore.BackupPassphraseStore;

        const tooShort = yield* backup
          .configure({
            projectId,
            change: { type: "set-folder", path: folder, passphrase: "short" },
          })
          .pipe(Effect.flip);
        assert.include(tooShort.message, "at least 8 characters");

        const status = yield* backup.configure({
          projectId,
          change: { type: "set-folder", path: folder, passphrase: "four words for my notes" },
        });
        const file = status.folder?.lastFile;
        assert.match(file ?? "", /^majordome-majordome-vault-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.age$/);
        assert.isNull(status.folder?.lastError ?? null);
        const work = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-work-" });
        yield* decryptFile({
          source: `${folder}/${file}`,
          target: `${work}/vault.bundle`,
          passphrase: "four words for my notes",
        });
        yield* gitIn(work, ["clone", "--quiet", `${work}/vault.bundle`, `${work}/restored`]);
        assert.equal(yield* fs.readFileString(`${work}/restored/memory.md`), "- Likes tea\n");

        const removed = yield* backup.configure({ projectId, change: { type: "remove-folder" } });
        assert.isNull(removed.folder);
        assert.isTrue(Option.isNone(yield* passphrases.get(MajordomeBackup.passphraseKey(root))));
      }),
  );

  it.effect("stops syncing when asked, and says so", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const backup = yield* backupFor(root);
      const remoteHead = yield* remoteMain(bare!);

      const status = yield* backup.configure({
        projectId,
        change: { type: "set-syncing", enabled: false },
      });
      assert.isFalse(status.remote?.syncing);
      yield* fs.writeFileString(`${root}/memory.md`, "- Local only\n");
      yield* backup.runCycle(root);
      assert.equal(yield* lastCommit(root), "Owner|Your edits");
      assert.equal(yield* remoteMain(bare!), remoteHead);
    }),
  );
});

it("backs up to a folder once a day, from the small hours on", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.isTrue(MajordomeBackup.folderBackupDue(undefined, at("2026-11-15T10:00:00")));
  assert.isFalse(MajordomeBackup.folderBackupDue("2026-11-15T03:00:00", at("2026-11-15T23:00:00")));
  assert.isFalse(MajordomeBackup.folderBackupDue("2026-11-14T23:00:00", at("2026-11-15T01:00:00")));
  assert.isTrue(MajordomeBackup.folderBackupDue("2026-11-14T23:00:00", at("2026-11-15T02:30:00")));
});
