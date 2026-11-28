import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_PHONE_PUSH_STORE,
  forgetRemovedPhonePushComputers,
  type PhonePushComputer,
  type PhonePushStore,
  phonePushRowValue,
  phonePushStanding,
  phonePushTestTargets,
  phonePushWork,
} from "./phonePush.logic";

const mac: PhonePushComputer = { id: "mac", connected: true, supported: true };
const server: PhonePushComputer = { id: "server", connected: true, supported: true };
const oldMac: PhonePushComputer = { id: "old", connected: true, supported: false };
const asleep: PhonePushComputer = { id: "asleep", connected: false, supported: false };

const registered = (canSend: boolean, token = "token-1") => ({
  endpoint: "phone:ios:abc",
  token,
  canSend,
});
const on = (registrations: PhonePushStore["registered"] = {}): PhonePushStore => ({
  wanted: true,
  registered: registrations,
});

describe("phonePushWork", () => {
  it("tells every connected computer that can take it, once per launch and per token", () => {
    const computers = [mac, server, oldMac, asleep];
    expect(phonePushWork({ store: on(), token: "token-1", computers, told: {} })).toEqual([
      { type: "register", environmentId: "mac" },
      { type: "register", environmentId: "server" },
    ]);
    expect(
      phonePushWork({ store: on(), token: "token-1", computers, told: { mac: "token-1" } }),
    ).toEqual([{ type: "register", environmentId: "server" }]);
    // A renewed token is told again.
    expect(
      phonePushWork({
        store: on(),
        token: "token-2",
        computers: [mac],
        told: { mac: "token-1" },
      }),
    ).toEqual([{ type: "register", environmentId: "mac" }]);
  });

  it("does nothing while off and unknown everywhere, or on with no token yet", () => {
    expect(
      phonePushWork({
        store: EMPTY_PHONE_PUSH_STORE,
        token: "token-1",
        computers: [mac],
        told: {},
      }),
    ).toEqual([]);
    expect(phonePushWork({ store: on(), token: null, computers: [mac], told: {} })).toEqual([]);
  });

  it("once off, tells each computer that knows this phone to forget it when it can be reached", () => {
    const store: PhonePushStore = {
      wanted: false,
      registered: { mac: registered(true), asleep: registered(true) },
    };
    expect(
      phonePushWork({ store, token: "token-1", computers: [mac, server, asleep], told: {} }),
    ).toEqual([{ type: "forget", environmentId: "mac", endpoint: "phone:ios:abc" }]);
    // The one that was asleep hears it the next time it connects.
    expect(
      phonePushWork({
        store: { wanted: false, registered: { asleep: registered(true) } },
        token: null,
        computers: [{ ...asleep, connected: true, supported: true }],
        told: {},
      }),
    ).toEqual([{ type: "forget", environmentId: "asleep", endpoint: "phone:ios:abc" }]);
  });
});

describe("phonePushStanding", () => {
  const standing = (input: Partial<Parameters<typeof phonePushStanding>[0]>) =>
    phonePushStanding({
      store: on({ mac: registered(true) }),
      permission: "granted",
      appCanReceive: true,
      tokenFailed: false,
      computers: [mac],
      ...input,
    });

  it.each([
    ["on when a computer can send", {}, "on"],
    ["off when the switch is off", { store: EMPTY_PHONE_PUSH_STORE }, "off"],
    ["denied when the phone's Settings refuse", { permission: "denied" as const }, "denied"],
    ["can't in a build with no way to receive", { appCanReceive: false }, "cant"],
    ["can't when the phone gives no address", { tokenFailed: true }, "cant"],
    ["can't when the only computer is too old", { store: on(), computers: [oldMac] }, "cant"],
    [
      "can't when the computer has no way to send",
      { store: on({ mac: registered(false) }) },
      "cant",
    ],
    [
      "on when one of several computers can send",
      { store: on({ mac: registered(false), server: registered(true) }), computers: [mac, server] },
      "on",
    ],
    ["on while no computer has answered yet", { store: on(), computers: [mac] }, "on"],
    [
      "on for a computer that could send and is asleep",
      { store: on({ asleep: registered(true) }), computers: [asleep] },
      "on",
    ],
  ])("is %s", (_name, input, expected) => {
    expect(standing(input)).toBe(expected);
  });

  it("says On in Settings only when notifications can arrive", () => {
    expect(["on", "off", "denied", "cant"].map((s) => phonePushRowValue(s as never))).toEqual([
      "On",
      "Off",
      "Off",
      "Off",
    ]);
  });
});

describe("the rest", () => {
  it("tests only connected computers that can reach this phone", () => {
    const store = on({
      mac: registered(true),
      server: registered(false),
      asleep: registered(true),
    });
    expect(phonePushTestTargets(store, [mac, server, asleep])).toEqual([
      { environmentId: "mac", endpoint: "phone:ios:abc" },
    ]);
  });

  it("forgets a removed computer, and keeps the same store when none was removed", () => {
    const store = on({ mac: registered(true), server: registered(true) });
    expect(forgetRemovedPhonePushComputers(store, () => true)).toBe(store);
    expect(forgetRemovedPhonePushComputers(store, (id) => id === "mac")).toEqual(
      on({ mac: registered(true) }),
    );
  });
});
