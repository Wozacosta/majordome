import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as BackupPassphraseStore from "./BackupPassphraseStore.ts";
import * as GoogleDriveAuth from "./GoogleDriveAuth.ts";
import * as MajordomeBackup from "./MajordomeBackup.ts";
import * as MajordomePeerSync from "./MajordomePeerSync.ts";
import { commitVaultRun } from "./VaultCommitReactor.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import { readVaultBrainId } from "./vaultBrainId.ts";
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
).pipe(
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-backup-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const projectId = ProjectId.make("vault-project");

// Nothing here may reach GitHub or Google unless a test hands in its fake.
const noNetwork = HttpClient.make(() => Effect.die("no network in tests"));

/** The backup service over one vault project, encrypting with a low work factor for speed. */
const backupFor = Effect.fn("test.backupFor")(function* (
  root: string,
  http: HttpClient.HttpClient = noNetwork,
) {
  const googleAuth = yield* GoogleDriveAuth.make.pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provideService(HostProcess.Environment, {
      MAJORDOME_GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
      MAJORDOME_GOOGLE_CLIENT_SECRET: "test-secret",
    }),
  );
  return yield* MajordomeBackup.make({ scryptWorkFactor: 10 }).pipe(
    Effect.provideService(ProjectStore.ProjectStoreV2, {
      get: () => Effect.succeedSome({ projectId, workspaceRoot: root }),
      list: () => Effect.succeed([{ projectId, workspaceRoot: root }]),
    } as unknown as ProjectStore.ProjectStoreV2["Service"]),
    Effect.provideService(GoogleDriveAuth.GoogleDriveAuth, googleAuth),
    Effect.provideService(ServerEnvironment.ServerEnvironment, {
      getDescriptor: Effect.succeed({ label: "MacBook" }),
    } as unknown as ServerEnvironment.ServerEnvironment["Service"]),
    Effect.provideService(HttpClient.HttpClient, http),
    // These vaults are on one machine only; MajordomePeerSync.test.ts covers two.
    Effect.provide(
      Layer.mock(MajordomePeerSync.MajordomePeerSync)({
        sync: () => Effect.succeed(null),
        status: () => Effect.succeed(null),
      }),
    ),
  );
});

interface FakeDriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly parents: ReadonlyArray<string>;
}

/** Google's sign-in and Drive, faked in memory: only the calls a backup makes. */
function fakeGoogleDrive() {
  const files: Array<FakeDriveFile> = [];
  const revoked: Array<string> = [];
  const control = { quotaFull: false };
  let nextId = 1;
  const json = (
    request: HttpClientRequest.HttpClientRequest,
    status: number,
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    HttpClientResponse.fromWeb(
      request,
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const params = new URLSearchParams(
        request.urlParams.params.map(([key, value]): [string, string] => [
          key,
          Redacted.isRedacted(value) ? Redacted.value(value) : value,
        ]),
      );
      const text =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      const route = `${request.method} ${url.host}${url.pathname}`;
      if (route === "POST oauth2.googleapis.com/device/code") {
        return json(request, 200, {
          device_code: "device-1",
          user_code: "WXYZ-1234",
          verification_url: "https://www.google.com/device",
          expires_in: 1800,
          interval: 5,
        });
      }
      if (route === "POST oauth2.googleapis.com/token") {
        return json(request, 200, {
          access_token: "ya29.access",
          refresh_token: "1//refresh",
          expires_in: 3599,
        });
      }
      if (route === "POST oauth2.googleapis.com/revoke") {
        revoked.push(new URLSearchParams(text).get("token") ?? "");
        return json(request, 200, {});
      }
      if (route === "GET www.googleapis.com/drive/v3/files") {
        const q = params.get("q") ?? "";
        const parent = /^'([^']+)' in parents/.exec(q)?.[1];
        const listed = parent
          ? files.filter((file) => file.parents.includes(parent))
          : files.filter((file) => file.mimeType === "application/vnd.google-apps.folder");
        return json(request, 200, { files: listed.map(({ id, name }) => ({ id, name })) });
      }
      if (request.method === "GET" && url.pathname.startsWith("/drive/v3/files/")) {
        const file = files.find((entry) => url.pathname.endsWith(`/${entry.id}`));
        return file ? json(request, 200, { id: file.id, trashed: false }) : json(request, 404, {});
      }
      if (route === "POST www.googleapis.com/drive/v3/files") {
        const id = `folder-${nextId++}`;
        files.push({ id, ...JSON.parse(text), parents: [] });
        return json(request, 200, { id });
      }
      if (route === "POST www.googleapis.com/upload/drive/v3/files") {
        if (control.quotaFull) {
          return json(request, 403, { error: { errors: [{ reason: "storageQuotaExceeded" }] } });
        }
        const metadata = JSON.parse(text) as { name: string; parents: Array<string> };
        return json(
          request,
          200,
          {},
          {
            location: `https://www.googleapis.com/upload/session?name=${encodeURIComponent(metadata.name)}&parent=${metadata.parents[0]}`,
          },
        );
      }
      if (route === "PUT www.googleapis.com/upload/session") {
        const id = `file-${nextId++}`;
        files.push({
          id,
          name: url.searchParams.get("name") ?? "",
          mimeType: "application/octet-stream",
          parents: [url.searchParams.get("parent") ?? ""],
        });
        return json(request, 200, { id });
      }
      if (request.method === "DELETE") {
        const index = files.findIndex((entry) => url.pathname.endsWith(`/${entry.id}`));
        if (index >= 0) files.splice(index, 1);
        return json(request, 204);
      }
      return json(request, 500, {});
    }),
  );
  return { http, files, revoked, control };
}

/** GitHub's device sign-in, faked; `created` lists the repositories Majordome asked for. */
function fakeGitHub() {
  const created: Array<string> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const json = (status: number, body: unknown) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        );
      switch (`${request.method} ${url.host}${url.pathname}`) {
        case "POST github.com/login/device/code":
          return json(200, {
            device_code: "device-1",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          });
        case "POST github.com/login/oauth/access_token":
          return json(200, { access_token: "gho_test" });
        case "POST api.github.com/user/repos":
          created.push("majordome-brain");
          return json(201, {
            clone_url: "https://github.com/owner/majordome-brain-2.git",
            html_url: "https://github.com/owner/majordome-brain-2",
            full_name: "owner/majordome-brain-2",
          });
        default:
          return json(500, {});
      }
    }),
  );
  return { http, created };
}

const lastCommit = (root: string) => gitIn(root, ["log", "-1", "--format=%an|%s"]);

it.layer(testLayer)("MajordomeBackup", (it) => {
  it.effect(
    "saves the owner's edits, sends them to the remote and reports the vault backed up",
    () =>
      Effect.gen(function* () {
        const { root, bare, fs } = yield* makeVault({ remote: true });
        const backup = yield* backupFor(root);
        yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n- Walks at noon\n");

        // The quick exchange saves the edits and leaves the remote for the full backup.
        const remoteHead = yield* remoteMain(bare!);
        yield* backup.backUpNow({ projectId, peerOnly: true });
        assert.equal(yield* lastCommit(root), "Owner|Your edits");
        assert.equal(yield* remoteMain(bare!), remoteHead);

        yield* backup.runCycle(root);

        assert.equal(yield* remoteMain(bare!), yield* gitIn(root, ["rev-parse", "HEAD"]));
        const status = yield* backup.getStatus({ projectId });
        assert.equal(status.brainId, yield* readVaultBrainId(root));
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

  it.effect("keeps both versions when a note changed in two places, and says so", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const backup = yield* backupFor(root);
      const elsewhere = yield* cloneElsewhere(bare!);
      yield* fs.writeFileString(`${elsewhere}/memory.md`, "- Likes coffee\n");
      yield* commitAll(elsewhere, "Your edits");
      yield* gitIn(elsewhere, ["push", "--quiet"]);
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes green tea\n");

      yield* backup.runCycle(root);

      const status = yield* backup.getStatus({ projectId });
      assert.isNull(status.paused);
      assert.isTrue(status.remote?.backedUp);
      assert.equal(yield* remoteMain(bare!), yield* gitIn(root, ["rev-parse", "HEAD"]));
      assert.equal(yield* fs.readFileString(`${root}/memory.md`), "- Likes coffee\n");
      const [kept] = status.otherVersions ?? [];
      assert.equal(kept?.path, "memory.md");
      assert.equal(yield* fs.readFileString(`${root}/${kept!.copy}`), "- Likes green tea\n");

      // The notice lasts as long as the other version does.
      yield* fs.remove(`${root}/${kept!.copy}`);
      yield* backup.runCycle(root);
      assert.deepStrictEqual((yield* backup.getStatus({ projectId })).otherVersions, []);
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

  it.effect("copies to Google Drive once signed in, says when Drive is full, and disconnects", () =>
    Effect.gen(function* () {
      const { root } = yield* makeVault();
      const google = fakeGoogleDrive();
      const backup = yield* backupFor(root, google.http);

      const noPassphrase = yield* backup.connectGoogleDriveStart({ projectId }).pipe(Effect.flip);
      assert.include(noPassphrase.message, "passphrase");
      yield* backup.configure({
        projectId,
        change: { type: "set-passphrase", passphrase: "four words for my notes" },
      });

      const prompt = yield* backup.connectGoogleDriveStart({ projectId });
      assert.deepStrictEqual(prompt, {
        status: "code",
        userCode: "WXYZ-1234",
        verificationUri: "https://www.google.com/device",
        expiresAt: 1_800_000,
      });
      const waiting = yield* Effect.forkChild(backup.connectGoogleDriveWait({ projectId }));
      yield* TestClock.adjust("5 seconds");
      const connected = yield* Fiber.join(waiting);

      assert.isTrue(connected.googleDrive.signedIn);
      assert.isNull(connected.drive?.problem ?? null);
      assert.match(
        connected.drive?.lastFile ?? "",
        /^majordome-majordome-vault-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.age$/,
      );
      const folder = google.files.find((file) => file.name === "Majordome backups");
      assert.isDefined(folder);
      assert.deepStrictEqual(
        google.files.filter((file) => file.parents.includes(folder!.id)).map((file) => file.name),
        [connected.drive?.lastFile],
      );

      // Today's copy again replaces the earlier one in the same folder.
      yield* backup.backUpNow({ projectId });
      assert.strictEqual(
        google.files.filter((file) => file.name === "Majordome backups").length,
        1,
      );
      assert.strictEqual(
        google.files.filter((file) => file.parents.includes(folder!.id)).length,
        1,
      );

      google.control.quotaFull = true;
      const full = yield* backup.backUpNow({ projectId });
      assert.strictEqual(full.drive?.problem, "quota-full");
      assert.include(full.drive?.lastError ?? "", "Google Drive is full");

      const disconnected = yield* backup.configure({
        projectId,
        change: { type: "disconnect-google-drive" },
      });
      assert.isNull(disconnected.drive);
      assert.isFalse(disconnected.googleDrive.signedIn);
      assert.deepStrictEqual(google.revoked, ["1//refresh"]);
    }),
  );

  it.effect("signing in to GitHub keeps the repository the notes were cloned from", () =>
    Effect.gen(function* () {
      const { root } = yield* makeVault();
      yield* gitIn(root, [
        "remote",
        "add",
        "origin",
        "https://github.com/owner/majordome-brain.git",
      ]);
      // A dead proxy keeps git off the network; the first push simply fails.
      yield* gitIn(root, ["config", "http.proxy", "http://127.0.0.1:9"]);
      const github = fakeGitHub();
      const backup = yield* backupFor(root, github.http);
      const lock = yield* VaultLock.VaultLock;

      // The first backup can take minutes on a large vault; signing in does not wait for it.
      const connected = yield* lock.withLock(
        root,
        Effect.gen(function* () {
          const prompt = yield* backup.connectGitHubStart({ projectId });
          assert.strictEqual(prompt.status, "code");
          const waiting = yield* Effect.forkChild(backup.connectGitHubWait({ projectId }));
          yield* TestClock.adjust("5 seconds");
          return yield* Fiber.join(waiting);
        }),
      );

      assert.deepStrictEqual(github.created, []);
      assert.isTrue(connected.github.signedIn);
      assert.strictEqual(connected.remote?.webUrl, "https://github.com/owner/majordome-brain");
      assert.strictEqual(yield* gitIn(root, ["remote"]), "origin");
    }),
  );
});

it("forgets a GitHub sign-in only once GitHub has refused it two rounds running", () => {
  assert.strictEqual(MajordomeBackup.afterSignInRefusal(false, false), "keep");
  // Git failed over the sign-in but GitHub still accepts it: nothing to forget, even after a refusal.
  assert.strictEqual(MajordomeBackup.afterSignInRefusal(false, true), "keep");
  assert.strictEqual(MajordomeBackup.afterSignInRefusal(true, false), "remember");
  assert.strictEqual(MajordomeBackup.afterSignInRefusal(true, true), "forget");
});

it("backs up to a folder once a day, from the small hours on", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.isTrue(MajordomeBackup.folderBackupDue(undefined, at("2026-11-15T10:00:00")));
  assert.isFalse(MajordomeBackup.folderBackupDue("2026-11-15T03:00:00", at("2026-11-15T23:00:00")));
  assert.isFalse(MajordomeBackup.folderBackupDue("2026-11-14T23:00:00", at("2026-11-15T01:00:00")));
  assert.isTrue(MajordomeBackup.folderBackupDue("2026-11-14T23:00:00", at("2026-11-15T02:30:00")));
});
