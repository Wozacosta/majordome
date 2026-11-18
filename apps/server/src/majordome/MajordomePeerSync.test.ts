import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MajordomePeerSync from "./MajordomePeerSync.ts";
import { PEER_HEAD_HEADER, PEER_VAULT_PATH } from "./peerRemote.ts";
import { peerRefusalAnswer, readPeerCall } from "./peerSyncHttp.ts";
import * as VaultActiveRuns from "./VaultActiveRuns.ts";
import * as VaultLock from "./VaultLock.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import { commitAll, FAKE_GITHUB_TOKEN, gitIn, makeVault } from "./vaultTestRepos.ts";

const testLayer = Layer.mergeAll(GitVcsDriver.layer, ProcessRunner.layer).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-peer-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

// Git tidies a repository in a detached process after some commands, and that process can still be
// writing when a test's folder is removed. Every git these tests start inherits this.
Object.assign(process.env, {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "gc.auto",
  GIT_CONFIG_VALUE_0: "0",
  GIT_CONFIG_KEY_1: "maintenance.auto",
  GIT_CONFIG_VALUE_1: "false",
});

const MAC = "env-mac";
const SERVER = "env-server";
const SERVER_URL = "https://majordome.tail1234.ts.net";
const PAIRING = "pairing-credential-1";
const BUNDLE_REF = "refs/majordome/sync-outgoing";

type Peers = MajordomePeerSync.MajordomePeerSync["Service"];

const noNetwork = HttpClient.make(() => Effect.die("no network in tests"));

/** One Majordome server: its own state folder, secrets and vaults. */
const makeMachine = Effect.fn("test.makeMachine")(function* (input: {
  readonly id: string;
  readonly label: string;
  readonly vaults: ReadonlyArray<string>;
  readonly http?: HttpClient.HttpClient;
}) {
  const config = Context.get(
    yield* Layer.build(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-peer-state-" })),
    ServerConfig.ServerConfig,
  );
  const secrets = Context.get(
    yield* Layer.build(Layer.fresh(ServerSecretStore.layer)).pipe(
      Effect.provideService(ServerConfig.ServerConfig, config),
    ),
    ServerSecretStore.ServerSecretStore,
  );
  const built = yield* Layer.build(Layer.fresh(MajordomePeerSync.layer)).pipe(
    Effect.provideService(ServerConfig.ServerConfig, config),
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
    Effect.provideService(ProjectStore.ProjectStoreV2, {
      list: () => Effect.succeed(input.vaults.map((workspaceRoot) => ({ workspaceRoot }))),
    } as unknown as ProjectStore.ProjectStoreV2["Service"]),
    Effect.provideService(ServerEnvironment.ServerEnvironment, {
      getEnvironmentId: Effect.succeed(input.id),
      getDescriptor: Effect.succeed({ environmentId: input.id, label: input.label }),
    } as unknown as ServerEnvironment.ServerEnvironment["Service"]),
    Effect.provideService(HttpClient.HttpClient, input.http ?? noNetwork),
    Effect.provide(Layer.merge(Layer.fresh(VaultLock.layer), VaultActiveRuns.layerIdle)),
  );
  return {
    peers: Context.get(built, MajordomePeerSync.MajordomePeerSync),
    secrets,
    ledgerPath: `${config.stateDir}/majordome/peers.json`,
  };
});

interface Wire {
  /** The session the server accepts; changing it is the server forgetting the one in use. */
  token: string;
  /** An older Majordome: it has no such address and answers with the app's page. */
  outdated: boolean;
  /** Runs once, after the server has given its news and before it takes the next ones. */
  beforeAccept: Effect.Effect<void> | null;
  readonly calls: Array<string>;
}

/**
 * The server's routes, answered by its own service. Mirrors `peerSyncHttp.ts`, which needs a
 * running server to test: the same call reading, the same answers for a refusal.
 */
const wireTo = Effect.fn("test.wireTo")(function* (server: Peers) {
  const fs = yield* FileSystem.FileSystem;
  const wire: Wire = { token: "session-1", outdated: false, beforeAccept: null, calls: [] };
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      const url = new URL(request.url);
      for (const [key, value] of request.urlParams.params) {
        url.searchParams.append(key, Redacted.isRedacted(value) ? Redacted.value(value) : value);
      }
      const answer = (
        status: number,
        body?: unknown,
        headers: Record<string, string> = { "content-type": "application/json" },
      ) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(
            body === undefined
              ? null
              : body instanceof Uint8Array
                ? new Uint8Array(body)
                : JSON.stringify(body),
            { status, headers },
          ),
        );
      const route = `${request.method} ${url.pathname}`;
      if (route === "GET /.well-known/t3/environment") {
        return answer(200, {
          environmentId: SERVER,
          label: "majordome",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "1.4.2",
          capabilities: { repositoryIdentity: true },
        });
      }
      const sent =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      if (route === "POST /oauth/token") {
        return new URLSearchParams(sent).get("subject_token") === PAIRING
          ? answer(200, { access_token: wire.token })
          : answer(400, {});
      }
      if (url.pathname !== PEER_VAULT_PATH) return answer(404, {});
      if (wire.outdated) {
        return answer(200, new TextEncoder().encode("<!doctype html>"), {
          "content-type": "text/html",
        });
      }
      if (request.headers.authorization !== `Bearer ${wire.token}`) return answer(401);
      const call = readPeerCall(url.searchParams);
      if (call === null) return answer(400);
      const temp = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-wire-" });
      const bundlePath = `${temp}/news.bundle`;
      if (request.method === "DELETE") {
        yield* server.forget(call).pipe(Effect.ignore);
        wire.calls.push("goodbye");
        return answer(204);
      }
      if (request.method === "GET") {
        const packed = yield* server.offer({ ...call, bundlePath }).pipe(Effect.result);
        if (packed._tag === "Failure") {
          const refusal = peerRefusalAnswer(packed.failure);
          return answer(refusal.status, refusal.body);
        }
        wire.calls.push(packed.success.packed ? "news" : "nothing new");
        const headers = {
          "content-type": "application/octet-stream",
          [PEER_HEAD_HEADER]: packed.success.head,
        };
        return packed.success.packed
          ? answer(200, yield* fs.readFile(bundlePath), headers)
          : answer(204, undefined, headers);
      }
      if (request.body._tag === "Stream") {
        yield* Stream.run(Stream.orDie(request.body.stream), fs.sink(bundlePath));
      }
      if (wire.beforeAccept !== null) {
        const before = wire.beforeAccept;
        wire.beforeAccept = null;
        yield* before;
      }
      const accepted = yield* server.accept({ ...call, bundlePath }).pipe(Effect.result);
      if (accepted._tag === "Failure") {
        const refusal = peerRefusalAnswer(accepted.failure);
        wire.calls.push(`refused: ${refusal.body.reason}`);
        return answer(refusal.status, refusal.body);
      }
      wire.calls.push(call.replay ? "sent, server replays" : "sent");
      return answer(200, accepted.success);
    }).pipe(Effect.scoped, Effect.orDie),
  );
  return { http, wire };
});

/** A vault that is not a copy of any other: two made in one second would share a first commit. */
const otherNotes = Effect.fn("test.otherNotes")(function* () {
  const { root } = yield* makeVault();
  yield* gitIn(root, ["commit", "--quiet", "--amend", "-m", "Somebody else's notes"]);
  return root;
});

/** The same notes on a Mac and on a server, and a way to link the Mac to the server. */
const twoMachines = Effect.fn("test.twoMachines")(function* () {
  const { root: mac, fs } = yield* makeVault();
  const parent = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-server-" });
  const server = `${parent}/brain`;
  yield* gitIn(parent, ["clone", "--quiet", mac, server]);
  yield* gitIn(server, ["remote", "remove", "origin"]);
  yield* gitIn(server, ["config", "user.name", "Owner"]);
  yield* gitIn(server, ["config", "user.email", "owner@example.com"]);
  yield* gitIn(server, ["config", "commit.gpgsign", "false"]);
  const there = yield* makeMachine({ id: SERVER, label: "majordome", vaults: [server] });
  const { http, wire } = yield* wireTo(there.peers);
  const here = yield* makeMachine({ id: MAC, label: "MacBook", vaults: [mac], http });
  const link = here.peers.link({
    vaultRoot: mac,
    url: `${SERVER_URL}/some/page`,
    credential: PAIRING,
    label: "majordome",
  });
  const sync = (options?: { readonly gitleaks?: string; readonly published?: string }) =>
    here.peers.sync({
      vaultRoot: mac,
      gitleaks: options?.gitleaks ?? null,
      published: options?.published ?? null,
    });
  const head = (root: string) => gitIn(root, ["rev-parse", "HEAD"]);
  return { mac, server, fs, here, there, wire, link, sync, head };
});

it.layer(testLayer)("MajordomePeerSync", (it) => {
  it.effect("notes changed on each machine end up on both", () =>
    Effect.gen(function* () {
      const { mac, server, fs, here, there, wire, link, sync, head } = yield* twoMachines();
      yield* link;
      yield* fs.writeFileString(`${server}/trips.md`, "- Lisbon\n");
      yield* commitAll(server, "Your edits");
      yield* fs.writeFileString(`${mac}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(mac, "Your edits");

      assert.deepStrictEqual(yield* sync(), { status: "synced", pushed: true, keptBoth: [] });
      assert.equal(yield* head(server), yield* head(mac));
      assert.equal(yield* fs.readFileString(`${mac}/trips.md`), "- Lisbon\n");
      assert.equal(
        yield* fs.readFileString(`${server}/memory.md`),
        "- Likes tea\n- Reads at night\n",
      );
      assert.equal(yield* gitIn(server, ["status", "--porcelain"]), "");
      assert.equal(yield* gitIn(mac, ["rev-list", "--count", "--merges", "HEAD"]), "0");
      assert.include(yield* here.peers.status(mac), {
        label: "majordome",
        environmentId: SERVER,
        linkedHere: true,
        inStep: true,
        problem: null,
      });
      assert.include(yield* there.peers.status(server), { label: "MacBook", linkedHere: false });

      // With nothing new on either side, nothing travels.
      wire.calls.length = 0;
      assert.deepStrictEqual(yield* sync(), { status: "synced", pushed: false, keptBoth: [] });
      assert.deepStrictEqual(wire.calls, ["nothing new"]);
    }),
  );

  it.effect("keeps both versions of a note changed on both machines", () =>
    Effect.gen(function* () {
      const { mac, server, fs, link, sync, head } = yield* twoMachines();
      yield* link;
      yield* fs.writeFileString(`${server}/memory.md`, "- Likes coffee\n");
      yield* commitAll(server, "Your edits");
      yield* fs.writeFileString(`${mac}/memory.md`, "- Likes green tea\n");
      yield* commitAll(mac, "Your edits");

      const result = yield* sync();
      assert.equal(result?.status, "synced");
      const copy = result?.status === "synced" ? result.keptBoth[0]?.copy : undefined;
      assert.match(copy ?? "", /^memory \(version from MacBook, \d{4}-\d\d-\d\d\)\.md$/);
      assert.equal(yield* head(server), yield* head(mac));
      assert.equal(yield* fs.readFileString(`${server}/memory.md`), "- Likes coffee\n");
      assert.equal(yield* fs.readFileString(`${server}/${copy}`), "- Likes green tea\n");
    }),
  );

  it.effect("tries again next time when the server changed while the Mac was sending", () =>
    Effect.gen(function* () {
      const { mac, server, fs, here, wire, link, sync, head } = yield* twoMachines();
      yield* link;
      yield* fs.writeFileString(`${mac}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(mac, "Your edits");
      wire.beforeAccept = Effect.gen(function* () {
        yield* fs.writeFileString(`${server}/trips.md`, "- Lisbon\n");
        yield* commitAll(server, "A routine's notes");
      }).pipe(Effect.provide(yield* Effect.context<GitVcsDriver.GitVcsDriver>()), Effect.orDie);
      wire.calls.length = 0;

      assert.deepStrictEqual(yield* sync(), { status: "moved" });
      assert.equal(yield* gitIn(server, ["rev-list", "--count", "HEAD"]), "2");
      assert.isFalse(yield* fs.exists(`${server}/.git/MERGE_HEAD`));
      // One miss is not worth a warning.
      assert.include(yield* here.peers.status(mac), { inStep: false, problem: null });

      assert.equal((yield* sync())?.status, "synced");
      assert.equal(yield* head(server), yield* head(mac));
      assert.equal(yield* fs.readFileString(`${mac}/trips.md`), "- Lisbon\n");
      assert.deepStrictEqual(wire.calls, ["nothing new", "refused: moved", "news", "sent"]);
    }),
  );

  it.effect("warns once the server has refused three times in a row", () =>
    Effect.gen(function* () {
      const { mac, server, fs, here, wire, link, sync } = yield* twoMachines();
      yield* link;
      yield* fs.writeFileString(`${mac}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(mac, "Your edits");
      // Unsaved edits to the same note on the server: taking the Mac's would write over them.
      const busy = fs
        .writeFileString(`${server}/memory.md`, "- Being typed right now\n")
        .pipe(Effect.orDie);
      for (const expected of [null, null, "keep changing"]) {
        yield* fs.writeFileString(`${server}/memory.md`, "- Likes tea\n");
        wire.beforeAccept = busy;
        assert.deepStrictEqual(yield* sync(), { status: "moved" });
        const problem = (yield* here.peers.status(mac))?.problem ?? null;
        if (expected === null) assert.isNull(problem);
        else assert.include(problem, expected);
      }
      assert.equal(yield* fs.readFileString(`${server}/memory.md`), "- Being typed right now\n");

      yield* gitIn(server, ["checkout", "--", "memory.md"]);
      assert.equal((yield* sync())?.status, "synced");
      assert.include(yield* here.peers.status(mac), { inStep: true, problem: null });
    }),
  );

  it.effect("gets the whole history when the server does not know the Mac's last commit", () =>
    Effect.gen(function* () {
      const { mac, server, fs, wire, link, sync, head } = yield* twoMachines();
      yield* link;
      yield* fs.writeFileString(`${server}/trips.md`, "- Lisbon\n");
      yield* commitAll(server, "Your edits");
      yield* fs.writeFileString(`${mac}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(mac, "Your edits");
      // As after the server was restored from an older copy: it never saw this commit.
      yield* gitIn(mac, ["update-ref", MajordomePeerSync.peerRef(SERVER), yield* head(mac)]);
      wire.calls.length = 0;

      assert.equal((yield* sync())?.status, "synced");
      assert.deepStrictEqual(wire.calls, ["news", "sent"]);
      assert.equal(yield* head(server), yield* head(mac));
      assert.equal(yield* gitIn(server, ["rev-list", "--count", "HEAD"]), "3");
    }),
  );

  it.effect(
    "leaves what the backup already holds as it is, and the server adds its own on top",
    () =>
      Effect.gen(function* () {
        const { mac, server, fs, wire, link, sync, head } = yield* twoMachines();
        yield* link;
        yield* fs.writeFileString(`${mac}/memory.md`, "- Likes tea\n- Reads at night\n");
        yield* commitAll(mac, "Your edits");
        const backedUp = yield* head(mac);
        yield* gitIn(mac, ["update-ref", "refs/remotes/origin/main", backedUp]);
        yield* fs.writeFileString(`${server}/trips.md`, "- Lisbon\n");
        yield* commitAll(server, "A routine's notes");
        wire.calls.length = 0;

        assert.equal((yield* sync({ published: "refs/remotes/origin/main" }))?.status, "synced");
        assert.deepStrictEqual(wire.calls, ["news", "sent, server replays"]);
        assert.equal(yield* head(mac), backedUp);
        assert.equal(yield* gitIn(server, ["rev-parse", "HEAD~1"]), backedUp);

        assert.equal((yield* sync({ published: "refs/remotes/origin/main" }))?.status, "synced");
        assert.equal(yield* head(mac), yield* head(server));
        assert.equal(yield* gitIn(mac, ["rev-parse", "HEAD~1"]), backedUp);
        assert.equal(yield* fs.readFileString(`${mac}/trips.md`), "- Lisbon\n");
      }),
  );

  it.effect("does not send a commit that holds a possible secret", () =>
    Effect.gen(function* () {
      const gitleaks = yield* findGitleaks();
      // gitleaks is part of the dev setup; without it there is no scan to test.
      if (gitleaks === null) return;
      const { mac, server, fs, wire, link, sync, head } = yield* twoMachines();
      yield* link;
      const before = yield* head(server);
      yield* fs.writeFileString(`${mac}/keys.md`, `token: ${FAKE_GITHUB_TOKEN}\n`);
      yield* commitAll(mac, "majordome: Saved a key");
      wire.calls.length = 0;

      assert.deepStrictEqual(yield* sync({ gitleaks }), { status: "secret", files: ["keys.md"] });
      assert.deepStrictEqual(wire.calls, ["nothing new"]);
      assert.equal(yield* head(server), before);
    }),
  );

  it.effect("keeps the session in the secret store, and forgets it when unlinked", () =>
    Effect.gen(function* () {
      const { mac, server, fs, here, there, wire, link } = yield* twoMachines();
      yield* link;
      const secretName = MajordomePeerSync.peerSessionSecret(mac);
      const stored = yield* here.secrets.get(secretName);
      assert.equal(
        Option.isSome(stored) ? new TextDecoder().decode(stored.value) : null,
        wire.token,
      );
      const ledger = yield* fs.readFileString(here.ledgerPath);
      assert.include(ledger, SERVER_URL);
      assert.notInclude(ledger, wire.token);
      assert.notInclude(ledger, PAIRING);
      assert.notInclude(ledger, "/some/page");

      assert.equal((yield* there.peers.status(server))?.label, "MacBook");
      yield* here.peers.unlink(mac);
      assert.isNull(yield* there.peers.status(server));
      assert.isTrue(Option.isNone(yield* here.secrets.get(secretName)));
      assert.isNull(yield* here.peers.status(mac));
      assert.notInclude(yield* fs.readFileString(here.ledgerPath), SERVER_URL);
    }),
  );

  it.effect("says the link needs making again when the server no longer accepts the session", () =>
    Effect.gen(function* () {
      const { mac, here, wire, link, sync } = yield* twoMachines();
      yield* link;
      wire.token = "session-2";

      assert.equal((yield* sync())?.status, "failed");
      const status = yield* here.peers.status(mac);
      assert.include(status, { needsReconnect: true, inStep: false });
      assert.include(status?.problem, "majordome no longer accepts this computer");

      // The app links them again with a new pairing credential.
      yield* link;
      assert.equal((yield* sync())?.status, "synced");
      assert.include(yield* here.peers.status(mac), { needsReconnect: false, inStep: true });
    }),
  );

  it.effect("refuses to link with a machine that holds other notes or is too old", () =>
    Effect.gen(function* () {
      const { mac, here, there, wire, link } = yield* twoMachines();
      wire.outdated = true;
      const outdated = yield* link.pipe(Effect.flip);
      assert.equal(outdated.reason, "outdated");
      assert.include(outdated.message, "Update Majordome there");
      assert.isNull(yield* here.peers.status(mac));

      wire.outdated = false;
      const tunnel = yield* here.peers
        .link({ vaultRoot: mac, url: "http://127.0.0.1:3774", credential: PAIRING, label: "x" })
        .pipe(Effect.flip);
      assert.equal(tunnel.reason, "bad-address");
      const other = yield* otherNotes();
      const elsewhere = yield* makeMachine({
        id: "env-other",
        label: "Mini",
        vaults: [other],
        http: (yield* wireTo(there.peers)).http,
      });
      const refused = yield* elsewhere.peers
        .link({ vaultRoot: other, url: SERVER_URL, credential: PAIRING, label: "majordome" })
        .pipe(Effect.flip);
      assert.equal(refused.reason, "other-notes");
      assert.isTrue(
        Option.isNone(yield* elsewhere.secrets.get(MajordomePeerSync.peerSessionSecret(other))),
      );
    }),
  );
});

it.layer(testLayer)("MajordomePeerSync, the answering machine", (it) => {
  /** A bundle of everything in `root`, as the asking machine packs it. */
  const bundleOf = Effect.fn("test.bundleOf")(function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "majordome-bundle-" });
    yield* gitIn(root, ["update-ref", BUNDLE_REF, "HEAD"]);
    yield* gitIn(root, ["bundle", "create", "--quiet", `${dir}/news.bundle`, BUNDLE_REF]);
    return `${dir}/news.bundle`;
  });
  const from = { label: "MacBook", environmentId: MAC };

  it.effect("refuses notes it does not hold, and history that belongs to other notes", () =>
    Effect.gen(function* () {
      const { mac, server, there, head } = yield* twoMachines();
      const brainId = yield* gitIn(server, ["rev-list", "--max-parents=0", "HEAD"]);
      const other = yield* otherNotes();
      const otherBrain = yield* gitIn(other, ["rev-list", "--max-parents=0", "HEAD"]);
      const before = yield* head(server);

      const unknown = yield* there.peers
        .accept({ brainId: otherBrain, bundlePath: yield* bundleOf(other), replay: false, from })
        .pipe(Effect.flip);
      assert.equal(unknown.reason, "unknown-notes");
      const wrong = yield* there.peers
        .accept({ brainId, bundlePath: yield* bundleOf(other), replay: true, from })
        .pipe(Effect.flip);
      assert.equal(wrong.reason, "other-notes");
      assert.equal(yield* head(server), before);
      assert.isNull(yield* there.peers.status(server));

      assert.deepStrictEqual(
        yield* there.peers.accept({
          brainId,
          bundlePath: yield* bundleOf(mac),
          replay: false,
          from,
        }),
        { head: before },
      );
    }),
  );

  it.effect("only ever moves forward, and leaves unsaved edits alone", () =>
    Effect.gen(function* () {
      const { mac, server, fs, there, head } = yield* twoMachines();
      const brainId = yield* gitIn(server, ["rev-list", "--max-parents=0", "HEAD"]);
      yield* fs.writeFileString(`${mac}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(mac, "Your edits");
      const bundlePath = yield* bundleOf(mac);

      // The server has a saved change the Mac's history does not hold.
      yield* fs.writeFileString(`${server}/trips.md`, "- Lisbon\n");
      yield* commitAll(server, "A routine's notes");
      const ahead = yield* head(server);
      const diverged = yield* there.peers
        .accept({ brainId, bundlePath, replay: false, from })
        .pipe(Effect.flip);
      assert.equal(diverged.reason, "moved");
      assert.equal(yield* head(server), ahead);
      assert.equal(yield* fs.readFileString(`${server}/memory.md`), "- Likes tea\n");

      // Back in line, but with an unsaved edit to the very note that arrives.
      yield* gitIn(server, ["reset", "--quiet", "--hard", "HEAD~1"]);
      const behind = yield* head(server);
      yield* fs.writeFileString(`${server}/memory.md`, "- Being typed right now\n");
      const dirty = yield* there.peers
        .accept({ brainId, bundlePath, replay: false, from })
        .pipe(Effect.flip);
      assert.equal(dirty.reason, "moved");
      assert.equal(yield* head(server), behind);
      assert.equal(yield* fs.readFileString(`${server}/memory.md`), "- Being typed right now\n");

      // An unsaved edit to another note does not stand in the way.
      yield* gitIn(server, ["checkout", "--", "memory.md"]);
      yield* fs.writeFileString(`${server}/draft.md`, "- Half a thought\n");
      assert.deepStrictEqual(
        yield* there.peers.accept({ brainId, bundlePath, replay: false, from }),
        { head: yield* head(mac) },
      );
      assert.equal(yield* fs.readFileString(`${server}/draft.md`), "- Half a thought\n");
    }),
  );
});
