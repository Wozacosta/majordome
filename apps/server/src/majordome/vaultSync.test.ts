import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { findGitleaks } from "./vaultSecretScan.ts";
import {
  backgroundSshCommand,
  remoteHost,
  remoteWebUrl,
  resolveVaultRemote,
  syncVault,
} from "./vaultSync.ts";
import {
  cloneElsewhere,
  commitAll,
  FAKE_GITHUB_TOKEN,
  gitIn,
  makeVault,
  remoteMain,
} from "./vaultTestRepos.ts";

const testLayer = Layer.mergeAll(GitVcsDriver.layer, ProcessRunner.layer).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "majordome-sync-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const sync = (root: string, gitleaks: string | null = null) =>
  Effect.gen(function* () {
    const remote = yield* resolveVaultRemote({ cwd: root, preferred: null });
    assert.isNotNull(remote);
    return yield* syncVault({ cwd: root, remote: remote!, gitleaks });
  });

it.layer(testLayer)("syncVault", (it) => {
  it.effect("sends saved changes to the remote", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(root, "Your edits");

      assert.deepStrictEqual(yield* sync(root), { status: "synced", pushed: true });
      assert.equal(yield* remoteMain(bare!), yield* gitIn(root, ["rev-parse", "HEAD"]));
      assert.deepStrictEqual(yield* sync(root), { status: "synced", pushed: false });
    }),
  );

  it.effect("puts this computer's changes on top of what arrived from elsewhere", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const elsewhere = yield* cloneElsewhere(bare!);
      yield* fs.writeFileString(`${elsewhere}/trips.md`, "- Lisbon\n");
      yield* commitAll(elsewhere, "Your edits");
      yield* gitIn(elsewhere, ["push", "--quiet"]);
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes tea\n- Reads at night\n");
      yield* commitAll(root, "Your edits");

      assert.deepStrictEqual(yield* sync(root), { status: "synced", pushed: true });
      assert.equal(yield* fs.readFileString(`${root}/trips.md`), "- Lisbon\n");
      assert.equal(yield* gitIn(root, ["rev-list", "--count", "--merges", "HEAD"]), "0");
      assert.equal(yield* remoteMain(bare!), yield* gitIn(root, ["rev-parse", "HEAD"]));
    }),
  );

  it.effect("stops on a conflict, leaves both sides as they were, and never forces", () =>
    Effect.gen(function* () {
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const elsewhere = yield* cloneElsewhere(bare!);
      yield* fs.writeFileString(`${elsewhere}/memory.md`, "- Likes coffee\n");
      yield* commitAll(elsewhere, "Your edits");
      yield* gitIn(elsewhere, ["push", "--quiet"]);
      const remoteHead = yield* remoteMain(bare!);
      yield* fs.writeFileString(`${root}/memory.md`, "- Likes green tea\n");
      yield* commitAll(root, "Your edits");
      const localHead = yield* gitIn(root, ["rev-parse", "HEAD"]);

      assert.deepStrictEqual(yield* sync(root), { status: "conflict", files: ["memory.md"] });
      assert.equal(yield* gitIn(root, ["rev-parse", "HEAD"]), localHead);
      assert.equal(yield* gitIn(root, ["status", "--porcelain"]), "");
      assert.isFalse(yield* fs.exists(`${root}/.git/rebase-merge`));
      assert.equal(yield* fs.readFileString(`${root}/memory.md`), "- Likes green tea\n");
      assert.equal(yield* remoteMain(bare!), remoteHead);
    }),
  );

  it.effect("does not send a commit that holds a possible secret", () =>
    Effect.gen(function* () {
      const gitleaks = yield* findGitleaks();
      // gitleaks is part of the dev setup; without it there is no scan to test.
      if (gitleaks === null) return;
      const { root, bare, fs } = yield* makeVault({ remote: true });
      const remoteHead = yield* remoteMain(bare!);
      yield* fs.writeFileString(`${root}/keys.md`, `token: ${FAKE_GITHUB_TOKEN}\n`);
      yield* commitAll(root, "majordome: Saved a key");

      assert.deepStrictEqual(yield* sync(root, gitleaks), { status: "secret", files: ["keys.md"] });
      assert.equal(yield* remoteMain(bare!), remoteHead);
    }),
  );

  it.effect("waits for unsaved edits instead of syncing around them", () =>
    Effect.gen(function* () {
      const { root, fs } = yield* makeVault({ remote: true });
      yield* fs.writeFileString(`${root}/memory.md`, "- Unsaved\n");
      assert.deepStrictEqual(yield* sync(root), { status: "skipped", reason: "unsaved-changes" });
    }),
  );
});

it("names where a remote lives", () => {
  assert.equal(remoteHost("git@github.com:someone/brain.git"), "github.com");
  assert.equal(remoteHost("https://github.com/someone/brain.git"), "github.com");
  assert.equal(remoteHost("ssh://me@vps.example.com/srv/brain.git"), "vps.example.com");
  assert.isNull(remoteHost("/srv/brain.git"));
  assert.equal(
    remoteWebUrl("git@github.com:someone/brain.git"),
    "https://github.com/someone/brain",
  );
  assert.isNull(remoteWebUrl("ssh://me@vps.example.com/srv/brain.git"));
});

it("never lets a background sync wait on an SSH agent prompt", () => {
  assert.equal(
    backgroundSshCommand({ hasKeyFile: true }),
    "ssh -o BatchMode=yes -o ConnectTimeout=20 -o IdentityAgent=none",
  );
  // Without a key file the agent is the only way in, so it stays, but nothing waits for input.
  assert.equal(
    backgroundSshCommand({ hasKeyFile: false }),
    "ssh -o BatchMode=yes -o ConnectTimeout=20",
  );
});
