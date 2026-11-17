import { EnvironmentId, type MajordomeBackupStatus, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupBrains } from "./brains.logic";
import { linkedPairKey, type PeerLinkCopy, peerLinkPlans } from "./peerLink.logic";

const MAC = EnvironmentId.make("env-mac");
const SERVER = EnvironmentId.make("env-server");
const MINI = EnvironmentId.make("env-mini");

type Peer = NonNullable<MajordomeBackupStatus["peer"]>;
const linkedTo = (environmentId: EnvironmentId, overrides?: Partial<Peer>): Peer => ({
  label: "other",
  environmentId,
  linkedHere: true,
  inStep: true,
  lastInStepAt: null,
  problem: null,
  needsReconnect: false,
  ...overrides,
});

const copy = (
  environmentId: EnvironmentId,
  peer: PeerLinkCopy["peer"],
  brainId: string | null = "brain-1",
): PeerLinkCopy => ({
  environmentId,
  projectId: ProjectId.make(`${environmentId}-notes`),
  brainId,
  peer,
});

const plans = (
  copies: ReadonlyArray<PeerLinkCopy>,
  options?: { readonly local?: EnvironmentId | null; readonly declined?: ReadonlyArray<string> },
) => {
  const localEnvironmentId = options?.local === undefined ? MAC : options.local;
  return peerLinkPlans({
    brains: groupBrains(copies, localEnvironmentId),
    localEnvironmentId,
    declined: new Set(options?.declined),
  }).map((plan) => `${plan.local.environmentId} -> ${plan.other.environmentId}`);
};

const PAIR = "brain:brain-1|env-mac|env-server";

describe("peerLinkPlans", () => {
  it("links this computer's notes with the same notes on another server", () => {
    expect(plans([copy(MAC, null), copy(SERVER, null)])).toEqual(["env-mac -> env-server"]);
    // The server answering this computer is what a working link looks like from its side.
    expect(
      plans([copy(MAC, linkedTo(SERVER)), copy(SERVER, linkedTo(MAC, { linkedHere: false }))]),
    ).toEqual([]);
  });

  it("links nothing from a browser or a phone, or for notes that are on one machine", () => {
    expect(plans([copy(MAC, null), copy(SERVER, null)], { local: null })).toEqual([]);
    expect(plans([copy(SERVER, null), copy(MINI, null)])).toEqual([]);
    expect(plans([copy(MAC, null)])).toEqual([]);
    expect(plans([copy(MAC, null), copy(SERVER, null, "brain-2")])).toEqual([]);
    // Before the first save a copy has no history to tell it is the same notes.
    expect(plans([copy(MAC, null, null), copy(SERVER, null, null)])).toEqual([]);
  });

  it("waits for a server too old to keep notes in step", () => {
    expect(plans([copy(MAC, null), copy(SERVER, undefined)])).toEqual([]);
    expect(plans([copy(MAC, undefined), copy(SERVER, null)])).toEqual([]);
    expect(plans([copy(MAC, null), copy(SERVER, undefined), copy(MINI, null)])).toEqual([
      "env-mac -> env-mini",
    ]);
  });

  it("makes a link again when the other machine stopped accepting it, with that machine only", () => {
    const lapsed = copy(MAC, linkedTo(SERVER, { needsReconnect: true, inStep: false }));
    expect(plans([lapsed, copy(MINI, null), copy(SERVER, null)])).toEqual([
      "env-mac -> env-server",
    ]);
    expect(plans([lapsed, copy(MINI, null)])).toEqual([]);
    // A link that only has trouble reaching the other machine is left to try again by itself.
    expect(
      plans([
        copy(MAC, linkedTo(SERVER, { problem: "Could not reach majordome.", inStep: false })),
        copy(SERVER, null),
      ]),
    ).toEqual([]);
  });

  it("leaves the work to the other machine when it already does it", () => {
    expect(plans([copy(MAC, null), copy(SERVER, linkedTo(MAC))])).toEqual([]);
    expect(plans([copy(MAC, null), copy(SERVER, linkedTo(MINI))])).toEqual([
      "env-mac -> env-server",
    ]);
  });

  it("stays off for a pair the owner stopped keeping in step", () => {
    const copies = [copy(MAC, null), copy(SERVER, null)];
    expect(plans(copies, { declined: [PAIR] })).toEqual([]);
    expect(plans(copies, { declined: ["brain:brain-1|env-mac|env-mini"] })).toEqual([
      "env-mac -> env-server",
    ]);
    expect(linkedPairKey("brain:brain-1", copy(MAC, linkedTo(SERVER)))).toBe(PAIR);
    expect(
      linkedPairKey("brain:brain-1", copy(SERVER, linkedTo(MAC, { linkedHere: false }))),
    ).toBeNull();
  });
});
