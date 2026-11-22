import { describe, expect, it } from "vite-plus/test";

import { generateLabel, REAP_BATCH, selectReapable } from "./broker.ts";
import { DAY, HOUR, makeIdentity, setup, START } from "./testing.ts";

describe("claim", () => {
  it("creates a tunnel, its ingress and a DNS record for a new computer", async () => {
    const { claim, cloudflare, rows } = setup();

    const address = await claim(await makeIdentity());

    const [row] = [...rows.values()];
    expect(row?.label).toMatch(/^[a-hjkmnp-z2-9]{8}$/u);
    expect(address).toEqual({
      hostname: `${row?.label}.majord.link`,
      url: `https://${row?.label}.majord.link`,
      connectorToken: expect.stringContaining(address.tunnelId),
      tunnelId: row?.tunnelId,
    });
    expect(cloudflare.calls).toEqual(["createTunnel", "putIngress", "createDnsRecord", "getToken"]);
    expect(cloudflare.tunnels.get(address.tunnelId)?.name).toBe(`majord-${row?.label}`);
    expect(cloudflare.ingress.get(address.tunnelId)).toEqual({
      hostname: address.hostname,
      port: 3774,
    });
    expect([...cloudflare.dnsRecords.values()]).toEqual([
      { hostname: address.hostname, tunnelId: address.tunnelId },
    ]);
  });

  it("gives a known computer its address back with a fresh token, outside the caps", async () => {
    const { claim, cloudflare } = setup({ perIp: 1, perDay: 1, live: 1 });
    const identity = await makeIdentity();
    const first = await claim(identity);
    cloudflare.calls.length = 0;

    const again = await claim(identity);

    expect(again).toEqual({ ...first, connectorToken: expect.any(String) });
    expect(again.connectorToken).not.toBe(first.connectorToken);
    expect(cloudflare.calls).toEqual(["getToken"]);
  });

  it("rewrites the ingress when the port changes", async () => {
    const { claim, cloudflare, rows } = setup();
    const identity = await makeIdentity();
    const first = await claim(identity);

    const moved = await claim(identity, "203.0.113.1", 4000);

    expect(moved.hostname).toBe(first.hostname);
    expect(cloudflare.ingress.get(first.tunnelId)?.port).toBe(4000);
    expect([...rows.values()][0]?.port).toBe(4000);
  });

  it("rebuilds a deleted tunnel under the same label", async () => {
    const { claim, cloudflare } = setup();
    const identity = await makeIdentity();
    const first = await claim(identity);
    cloudflare.tunnels.delete(first.tunnelId);

    const rebuilt = await claim(identity);

    expect(rebuilt.hostname).toBe(first.hostname);
    expect(rebuilt.tunnelId).not.toBe(first.tunnelId);
    expect([...cloudflare.dnsRecords.values()]).toEqual([
      { hostname: first.hostname, tunnelId: rebuilt.tunnelId },
    ]);
  });

  it("finishes a claim that failed after its tunnel and DNS record were created", async () => {
    const { claim, cloudflare, patch, rows } = setup();
    const identity = await makeIdentity();
    const first = await claim(identity);
    const label = [...rows.keys()][0] ?? "";
    patch(label, { tunnelId: null, dnsRecordId: null });
    const failOnce = cloudflare.client.createDnsRecord;
    let failed = false;
    const client = cloudflare.client as { createDnsRecord: typeof failOnce };
    client.createDnsRecord = async (hostname, tunnelId) => {
      if (!failed) {
        failed = true;
        throw new Error("record already exists");
      }
      return failOnce(hostname, tunnelId);
    };

    const resumed = await claim(identity);

    expect(resumed.tunnelId).toBe(first.tunnelId);
    expect(cloudflare.tunnels.size).toBe(1);
    expect(cloudflare.dnsRecords.size).toBe(1);
  });

  it("rejects a port outside 1024-65535", async () => {
    const { claim } = setup();
    for (const port of [80, 70_000, 3774.5]) {
      await expect(claim(await makeIdentity(), "203.0.113.1", port)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
  });

  it("limits new addresses per client IP per day", async () => {
    const { claim, clock } = setup();
    for (let index = 0; index < 3; index++) await claim(await makeIdentity(), "198.51.100.7");

    await expect(claim(await makeIdentity(), "198.51.100.7")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await claim(await makeIdentity(), "198.51.100.8");
    clock.now += DAY + 1;
    await claim(await makeIdentity(), "198.51.100.7");
  });

  it("limits new addresses per day in total, counting released ones", async () => {
    const { claim, release } = setup({ perDay: 2 });
    const first = await makeIdentity();
    await claim(first, "198.51.100.1");
    await claim(await makeIdentity(), "198.51.100.2");
    await release(first);

    await expect(claim(await makeIdentity(), "198.51.100.3")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("is full at the ceiling of live addresses until one is released", async () => {
    const { claim, release } = setup({ live: 2 });
    const first = await makeIdentity();
    await claim(first, "198.51.100.1");
    await claim(await makeIdentity(), "198.51.100.2");
    const third = await makeIdentity();

    await expect(claim(third, "198.51.100.3")).rejects.toMatchObject({ code: "full" });
    await release(first);
    await claim(third, "198.51.100.3");
  });

  it("refuses a blocked computer, also once its address is gone", async () => {
    const { broker, claim, cloudflare, patch, rows } = setup();
    const identity = await makeIdentity();
    const address = await claim(identity);
    cloudflare.setTunnel(address.tunnelId, { status: "healthy", connsActiveAt: START });
    patch([...rows.keys()][0] ?? "", { blocked: true });

    await expect(claim(identity)).rejects.toMatchObject({ code: "blocked" });
    expect(await broker.reap()).toMatchObject({ reaped: 1, failed: 0 });
    expect(cloudflare.tunnels.size).toBe(0);
    expect(cloudflare.dnsRecords.size).toBe(0);
    await expect(claim(identity)).rejects.toMatchObject({ code: "blocked" });
  });
});

describe("release", () => {
  it("removes the tunnel and DNS record and never reuses the label", async () => {
    const { claim, release, cloudflare, rows } = setup();
    const identity = await makeIdentity();
    const first = await claim(identity);
    cloudflare.setTunnel(first.tunnelId, { status: "healthy", connsActiveAt: START });

    await release(identity);
    await release(identity);

    expect(cloudflare.tunnels.size).toBe(0);
    expect(cloudflare.dnsRecords.size).toBe(0);
    expect([...rows.values()].map((row) => row.reapedAt)).toEqual([START]);
    expect((await claim(identity)).hostname).not.toBe(first.hostname);
  });

  it("does nothing for a computer that has no address", async () => {
    const { release, cloudflare } = setup();
    await release(await makeIdentity());
    expect(cloudflare.calls).toEqual([]);
  });

  it("rejects a claim proof", async () => {
    const { broker, claim, clock } = setup();
    const identity = await makeIdentity();
    await claim(identity);
    await expect(
      broker.release({
        publicKey: identity.publicKey,
        proof: await identity.proof("claim", clock.now),
        clientIp: "203.0.113.1",
      }),
    ).rejects.toMatchObject({ code: "invalid_proof" });
  });
});

describe("reap", () => {
  it("removes idle and never-connected addresses and leaves everything else", async () => {
    const { broker, claim, clock, cloudflare, rows } = setup({ perIp: 10 });
    const addresses = [];
    for (let index = 0; index < 5; index++) addresses.push(await claim(await makeIdentity()));
    const [connected, idle, recentlyIdle, neverConnected, replaced] = addresses.map(
      (address) => address.tunnelId,
    );
    clock.now += 25 * HOUR;
    const young = await claim(await makeIdentity());
    clock.now += 20 * DAY;
    const longAgo = clock.now - 15 * DAY;
    cloudflare.setTunnel(connected ?? "", { status: "healthy", connsActiveAt: longAgo });
    cloudflare.setTunnel(idle ?? "", { status: "down", connsInactiveAt: longAgo });
    cloudflare.setTunnel(recentlyIdle ?? "", { status: "down", connsInactiveAt: clock.now - DAY });
    cloudflare.setTunnel(young.tunnelId, { createdAt: clock.now - HOUR });
    // The table names another tunnel for this label, so this one is not the broker's to delete.
    cloudflare.setTunnel(replaced ?? "", { id: "someone-else" });
    for (const name of ["majord-zzzzzzzz", "other-service"]) {
      cloudflare.setTunnel(await cloudflare.client.createTunnel(name), { createdAt: longAgo });
    }

    expect(await broker.reap()).toEqual({ candidates: 2, reaped: 2, failed: 0 });

    const gone = [idle, neverConnected];
    expect([...cloudflare.tunnels.keys()].filter((id) => gone.includes(id))).toEqual([]);
    expect(cloudflare.tunnels.size).toBe(6);
    expect(
      [...rows.values()].filter((row) => row.reapedAt !== null).map((row) => row.tunnelId),
    ).toEqual(gone);
    expect([...cloudflare.dnsRecords.values()].map((record) => record.tunnelId)).toEqual([
      connected,
      recentlyIdle,
      replaced,
      young.tunnelId,
    ]);
  });

  it("leaves an idle address whose computer reconnected before the delete", () => {
    const row = {
      label: "k7m2xq9d",
      identity: "a",
      port: 3774,
      tunnelId: "t1",
      dnsRecordId: "d1",
      clientIp: "203.0.113.1",
      createdAt: START,
      blocked: false,
      reapedAt: null,
    };
    const tunnel = {
      id: "t1",
      name: "majord-k7m2xq9d",
      status: "healthy",
      createdAt: START,
      connsActiveAt: START + 30 * DAY,
      connsInactiveAt: null,
    };
    const now = START + 40 * DAY;

    expect(selectReapable({ rows: [row], tunnels: [tunnel], now })).toEqual([]);
    expect(selectReapable({ rows: [{ ...row, blocked: true }], tunnels: [tunnel], now })).toEqual([
      { row: { ...row, blocked: true }, tunnelId: "t1", force: true },
    ]);
  });

  it("removes a bounded batch per run and carries on in the next one", async () => {
    const { broker, claim, clock, cloudflare, rows } = setup({ perIp: 100 });
    for (let index = 0; index < 20; index++) await claim(await makeIdentity());
    clock.now += 2 * DAY;
    const live = () => [...rows.values()].filter((row) => row.reapedAt === null).length;

    for (const remaining of [20 - REAP_BATCH, 20 - 2 * REAP_BATCH, 0]) {
      cloudflare.calls.length = 0;
      await broker.reap();
      expect(live()).toBe(remaining);
      expect(cloudflare.calls.length).toBeLessThan(50);
      clock.now += HOUR;
    }
  });
});

describe("generateLabel", () => {
  it("draws 8 characters and never a look-alike", () => {
    const bytes = (text: string) => () =>
      Uint8Array.from(text, (char) => "abcdefghjkmnpqrstuvwxyz23456789".indexOf(char) & 31);
    expect(generateLabel(bytes("k7m2xq9dzzzzzzzz"))).toBe("k7m2xq9d");
    // "i", "l" and "o" are not in the alphabet, so they map to the rejected value.
    expect(generateLabel(bytes("iklo7m2xq9d3zzzz"))).toBe("k7m2xq9d");
  });
});
