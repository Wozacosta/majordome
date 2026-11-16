// @effect-diagnostics nodeBuiltinImport:off -- Reads the repository's compose file to compare it with the embedded copy.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import type { HetznerLocation, HetznerPricing, HetznerServerType } from "./hetznerApi.ts";
import { DEPLOY_COMPOSE_FILE } from "./serverMoveCompose.ts";
import {
  cloudInitFor,
  composeFileFor,
  defaultLocation,
  freeName,
  locationChoices,
  monthlyPriceOf,
  rankServerTypes,
} from "./serverMovePlan.ts";

const NOW = Date.parse("2026-11-16T10:00:00Z");

const type = (
  name: string,
  options: {
    readonly memory?: number;
    readonly cpu?: string;
    readonly arch?: string;
    readonly prices: Readonly<Record<string, string>>;
    readonly locations?: HetznerServerType["locations"];
  },
): HetznerServerType => ({
  id: name.length,
  name,
  cores: 2,
  memory: options.memory ?? 4,
  disk: 40,
  cpu_type: options.cpu ?? "shared",
  architecture: options.arch ?? "x86",
  prices: Object.entries(options.prices).map(([location, gross]) => ({
    location,
    price_monthly: { net: gross, gross },
    price_hourly: { net: "0.0100", gross: "0.0100" },
  })),
  ...(options.locations === undefined ? {} : { locations: options.locations }),
});

const location = (name: string, city: string, country: string, zone: string): HetznerLocation => ({
  name,
  city,
  country,
  network_zone: zone,
});

const types: ReadonlyArray<HetznerServerType> = [
  type("cx23", { prices: { fsn1: "4.1500", nbg1: "4.1500" } }),
  type("cpx22", { prices: { fsn1: "7.1300", ash: "8.3200", sin: "9.9900" } }),
  type("cax11", { arch: "arm", prices: { fsn1: "3.9900" } }),
  type("cx11", { memory: 1, prices: { fsn1: "2.0000" } }),
  type("ccx13", { cpu: "dedicated", prices: { fsn1: "1.0000" } }),
];

describe("which server to order", () => {
  it("prefers the cheapest shared Intel/AMD type with enough memory, then ARM", () => {
    expect(rankServerTypes(types, "fsn1", NOW).map((candidate) => candidate.name)).toEqual([
      "cx23",
      "cpx22",
      "cax11",
    ]);
    expect(rankServerTypes(types, "ash", NOW).map((candidate) => candidate.name)).toEqual([
      "cpx22",
    ]);
    expect(rankServerTypes(types, "hel1", NOW)).toEqual([]);
  });

  it("leaves out a type Hetzner cannot deliver or has retired in that location", () => {
    const listed = [
      type("cx23", {
        prices: { fsn1: "4.1500", nbg1: "4.1500", hel1: "4.1500" },
        locations: [
          { name: "fsn1", available: false, deprecation: null },
          {
            name: "nbg1",
            available: true,
            deprecation: { unavailable_after: "2026-01-01T00:00:00Z" },
          },
          {
            name: "hel1",
            available: true,
            deprecation: { unavailable_after: "2027-01-01T00:00:00Z" },
          },
        ],
      }),
    ];
    expect(rankServerTypes(listed, "fsn1", NOW)).toEqual([]);
    expect(rankServerTypes(listed, "nbg1", NOW)).toEqual([]);
    expect(rankServerTypes(listed, "hel1", NOW)).toHaveLength(1);
  });

  it("prices a location as its best type plus the IPv4 address Hetzner bills beside it", () => {
    const pricing: HetznerPricing = {
      currency: "EUR",
      primary_ips: [
        {
          type: "ipv4",
          prices: [{ location: "fsn1", price_monthly: { net: "0.5", gross: "0.6000" } }],
        },
      ],
    };
    expect(monthlyPriceOf(types[0]!, "fsn1", pricing)).toBe("4.75");
    expect(monthlyPriceOf(types[0]!, "fsn1", null)).toBe("4.15");
    expect(monthlyPriceOf(types[0]!, "sin", pricing)).toBeNull();
    expect(
      locationChoices({
        types,
        locations: [
          location("fsn1", "Falkenstein", "DE", "eu-central"),
          location("ash", "Ashburn, VA", "US", "us-east"),
          location("hel1", "Helsinki", "FI", "eu-central"),
        ],
        pricing,
        now: NOW,
      }),
    ).toEqual([
      {
        name: "fsn1",
        city: "Falkenstein",
        country: "DE",
        serverType: "cx23",
        monthlyPrice: "4.75",
      },
      {
        name: "ash",
        city: "Ashburn, VA",
        country: "US",
        serverType: "cpx22",
        monthlyPrice: "8.32",
      },
    ]);
  });

  it("defaults to the location nearest the owner's time zone among those on offer", () => {
    const choice = (name: string) => ({
      name,
      city: name,
      country: "",
      serverType: "cx23",
      monthlyPrice: "1.00",
    });
    const all = ["fsn1", "nbg1", "hel1", "ash", "hil", "sin"].map(choice);
    expect(defaultLocation("Europe/Paris", all)).toBe("nbg1");
    expect(defaultLocation("Africa/Cairo", all)).toBe("nbg1");
    expect(defaultLocation("America/New_York", all)).toBe("ash");
    expect(defaultLocation("America/Los_Angeles", all)).toBe("hil");
    expect(defaultLocation("Asia/Tokyo", all)).toBe("sin");
    expect(defaultLocation("Asia/Tokyo", [choice("fsn1"), choice("ash")])).toBe("fsn1");
    expect(defaultLocation("Europe/Paris", [choice("ash")])).toBe("ash");
    expect(defaultLocation("Europe/Paris", [])).toBeNull();
  });

  it("takes the next free name", () => {
    expect(freeName("majordome", new Set())).toBe("majordome");
    expect(freeName("majordome", new Set(["majordome", "majordome-2"]))).toBe("majordome-3");
  });
});

describe("the new server's first-boot script", () => {
  const input = {
    version: "1.4.2",
    authKey: "tskey-auth-kTESTKEY1CNTRL-abcdefghijklmnop",
    setupSecret: "mjsetup-1794744000-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    timeZone: "Europe/Paris",
    hostname: "majordome",
    publicUrl: "https://majordome.tail1234.ts.net",
  };

  it("embeds the repository's compose file word for word", () => {
    const deployed = NodeFS.readFileSync(
      NodePath.join(import.meta.dirname, "../../../../deploy/docker-compose.yml"),
      "utf8",
    );
    expect(DEPLOY_COMPOSE_FILE).toBe(deployed);
  });

  it("pins the image to this server's version instead of latest", () => {
    const compose = composeFileFor("1.4.2");
    expect(compose).toContain("image: ghcr.io/wozacosta/majordome:1.4.2\n");
    expect(compose).not.toContain("majordome:latest");
    expect(compose.replace("majordome:1.4.2", "majordome:latest")).toBe(DEPLOY_COMPOSE_FILE);
  });

  it("installs Docker, writes the compose file and its .env, and starts it", () => {
    const script = cloudInitFor(input)!;
    const compose = composeFileFor("1.4.2")
      .trimEnd()
      .split("\n")
      .map((line) => (line === "" ? "" : `      ${line}`))
      .join("\n");
    expect(script).toBe(
      [
        "#cloud-config",
        "# Majordome: installs Docker and starts Majordome behind Tailscale. Nothing listens publicly.",
        "package_update: true",
        "packages:",
        "  - ca-certificates",
        "  - curl",
        "write_files:",
        "  - path: /opt/majordome/docker-compose.yml",
        '    permissions: "0644"',
        "    content: |",
        compose,
        "  - path: /opt/majordome/.env",
        '    permissions: "0600"',
        "    content: |",
        "      TS_AUTHKEY=tskey-auth-kTESTKEY1CNTRL-abcdefghijklmnop",
        "      TZ=Europe/Paris",
        "      MAJORDOME_HOSTNAME=majordome",
        "      MAJORDOME_PUBLIC_URL=https://majordome.tail1234.ts.net",
        "      MAJORDOME_SETUP_SECRET=mjsetup-1794744000-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "runcmd:",
        "  - [sh, -c, 'for attempt in 1 2 3 4 5 6 7 8 9 10; do curl -fsSL https://get.docker.com | sh && break; sleep 15; done']",
        "  - [sh, -c, 'for attempt in 1 2 3 4 5 6 7 8 9 10; do docker compose --project-directory /opt/majordome up -d && break; sleep 15; done']",
        "",
      ].join("\n"),
    );
    // Hetzner refuses user data over 32 KiB.
    expect(new TextEncoder().encode(script).length).toBeLessThan(32 * 1024);
  });

  it("carries the two one-time secrets and nothing else that is secret", () => {
    const script = cloudInitFor(input)!;
    // Every value the script sets is a line of the .env file.
    const assigned = script.split("\n").flatMap((line) => /^ {6}([A-Z_]+)=/.exec(line)?.[1] ?? []);
    expect(assigned).toEqual([
      "TS_AUTHKEY",
      "TZ",
      "MAJORDOME_HOSTNAME",
      "MAJORDOME_PUBLIC_URL",
      "MAJORDOME_SETUP_SECRET",
    ]);
    expect(script.split(input.authKey)).toHaveLength(2);
    expect(script.split(input.setupSecret)).toHaveLength(2);
    expect(script).not.toContain("tskey-client-");
    expect(script).not.toContain("ghp_");
  });

  it("falls back to UTC for an odd time zone, and refuses a value that could add lines", () => {
    expect(cloudInitFor({ ...input, timeZone: "Europe/Paris\nEVIL=1" })).toContain(
      "      TZ=UTC\n",
    );
    expect(cloudInitFor({ ...input, authKey: "tskey-auth-x\nEVIL=1" })).toBeNull();
    expect(cloudInitFor({ ...input, setupSecret: "a b" })).toBeNull();
    expect(cloudInitFor({ ...input, hostname: "majordome'; rm -rf /" })).toBeNull();
  });
});
