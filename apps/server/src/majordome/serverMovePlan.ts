/**
 * The decisions "Set up a server for me" makes without asking anyone: which server to order,
 * where, under what name, and the first-boot script that turns a bare machine into a Majordome
 * server with no one logging in to it.
 */

import type { MajordomeServerMoveLocation } from "@t3tools/contracts";

import type { HetznerLocation, HetznerPricing, HetznerServerType } from "./hetznerApi.ts";
import { DEPLOY_COMPOSE_FILE } from "./serverMoveCompose.ts";

/** The always-on guide's floor; smaller servers run out of memory during a run. */
const MIN_MEMORY_GB = 2;
const IMAGE_REPOSITORY = "ghcr.io/wozacosta/majordome";
/** The Ubuntu LTS release the compose setup is used on. */
export const SERVER_IMAGE = "ubuntu-24.04";
export const SERVER_BASE_NAME = "majordome";
const SERVER_DIRECTORY = "/opt/majordome";

const monthly = (price: { readonly gross: string }) => Number.parseFloat(price.gross);

function orderableIn(type: HetznerServerType, location: string, now: number): boolean {
  if (type.prices.every((price) => price.location !== location)) return false;
  // Older answers have no per-location list; a price there is then the only sign.
  if (type.locations === undefined) return true;
  const entry = type.locations.find((candidate) => candidate.name === location);
  if (entry === undefined || entry.available === false) return false;
  const gone = entry.deprecation?.unavailable_after;
  return gone === undefined || Number.isNaN(Date.parse(gone)) || Date.parse(gone) > now;
}

/**
 * The shared server types that fit Majordome and can be ordered in `location` now, best first:
 * the cheapest Intel/AMD one, then the rest by price, then ARM ones. Read from Hetzner's own
 * list every time, since Hetzner retires and renames types.
 */
export function rankServerTypes(
  types: ReadonlyArray<HetznerServerType>,
  location: string,
  now: number,
): ReadonlyArray<HetznerServerType> {
  const priceIn = (type: HetznerServerType) =>
    monthly(type.prices.find((price) => price.location === location)!.price_monthly);
  return types
    .filter(
      (type) =>
        type.cpu_type === "shared" &&
        type.memory >= MIN_MEMORY_GB &&
        orderableIn(type, location, now),
    )
    .toSorted(
      (left, right) =>
        Number(left.architecture !== "x86") - Number(right.architecture !== "x86") ||
        priceIn(left) - priceIn(right) ||
        left.name.localeCompare(right.name),
    );
}

/** A month of `type` in `location` plus its IPv4 address, tax included, as `"4.75"`. */
export function monthlyPriceOf(
  type: HetznerServerType,
  location: string,
  pricing: HetznerPricing | null,
): string | null {
  const server = type.prices.find((price) => price.location === location);
  if (server === undefined) return null;
  const address = pricing?.primary_ips
    ?.find((entry) => entry.type === "ipv4")
    ?.prices.find((price) => price.location === location);
  return (
    monthly(server.price_monthly) + (address === undefined ? 0 : monthly(address.price_monthly))
  ).toFixed(2);
}

/** Every location a server can be ordered in, with what the best type and its address cost. */
export function locationChoices(input: {
  readonly types: ReadonlyArray<HetznerServerType>;
  readonly locations: ReadonlyArray<HetznerLocation>;
  readonly pricing: HetznerPricing | null;
  readonly now: number;
}): ReadonlyArray<MajordomeServerMoveLocation> {
  return input.locations.flatMap((location) => {
    const best = rankServerTypes(input.types, location.name, input.now)[0];
    const monthlyPrice =
      best === undefined ? null : monthlyPriceOf(best, location.name, input.pricing);
    if (best === undefined || monthlyPrice === null) return [];
    return [
      {
        name: location.name,
        city: location.city,
        country: location.country,
        serverType: best.name,
        monthlyPrice,
      },
    ];
  });
}

const WEST_AMERICA =
  /^America\/(Los_Angeles|Vancouver|Tijuana|Phoenix|Denver|Boise|Edmonton|Anchorage|Juneau|Whitehorse)$/;

/**
 * The location nearest the owner by a simple rule on their time zone, among those on offer:
 * the Americas go to the US, Asia and Oceania to Singapore, everyone else to the EU.
 */
export function defaultLocation(
  timeZone: string,
  choices: ReadonlyArray<MajordomeServerMoveLocation>,
): string | null {
  const preferred = WEST_AMERICA.test(timeZone)
    ? ["hil", "ash"]
    : timeZone.startsWith("America/") || timeZone.startsWith("US/")
      ? ["ash", "hil"]
      : /^(Asia|Australia|Pacific)\//.test(timeZone)
        ? ["sin"]
        : [];
  for (const name of [...preferred, "nbg1", "fsn1", "hel1"]) {
    if (choices.some((choice) => choice.name === name)) return name;
  }
  return choices[0]?.name ?? null;
}

/** `base`, or `base-2`, `base-3`… when the name is taken. */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A released version's image; development builds have a version no image was published for. */
export const serverImageFor = (version: string) => `${IMAGE_REPOSITORY}:${version}`;

/** The compose file pinned to one image, so the server runs the version this computer runs. */
export function composeFileFor(version: string): string {
  return DEPLOY_COMPOSE_FILE.replace(
    `image: ${IMAGE_REPOSITORY}:latest`,
    `image: ${serverImageFor(version)}`,
  );
}

const SAFE_ENV_VALUE = /^[A-Za-z0-9_.:/+@=-]+$/;

export interface CloudInitInput {
  readonly version: string;
  /** The one-time Tailscale key; spent when the server joins. */
  readonly authKey: string;
  /** The one-time pairing secret; spent when this computer connects. */
  readonly setupSecret: string;
  readonly timeZone: string;
  /** The name to take on the Tailscale network. */
  readonly hostname: string;
  /** The address that name gives, such as `https://majordome.tail1234.ts.net`. */
  readonly publicUrl: string;
}

const indent = (text: string, spaces: number) =>
  text
    .split("\n")
    .map((line) => (line === "" ? "" : " ".repeat(spaces) + line))
    .join("\n");

/**
 * The user data Hetzner hands the new machine: Docker, the compose file, its `.env`, and start.
 * Only the two one-time secrets are in it. Null when a value could break out of the `.env` file.
 */
export function cloudInitFor(input: CloudInitInput): string | null {
  const env: ReadonlyArray<readonly [string, string]> = [
    ["TS_AUTHKEY", input.authKey],
    ["TZ", SAFE_ENV_VALUE.test(input.timeZone) ? input.timeZone : "UTC"],
    ["MAJORDOME_HOSTNAME", input.hostname],
    ["MAJORDOME_PUBLIC_URL", input.publicUrl],
    ["MAJORDOME_SETUP_SECRET", input.setupSecret],
  ];
  if (env.some(([, value]) => !SAFE_ENV_VALUE.test(value))) return null;
  // apt can be busy with the image's own first-boot updates, and a download can drop: try again.
  const retried = (command: string) =>
    `for attempt in 1 2 3 4 5 6 7 8 9 10; do ${command} && break; sleep 15; done`;
  return [
    "#cloud-config",
    "# Majordome: installs Docker and starts Majordome behind Tailscale. Nothing listens publicly.",
    "package_update: true",
    "packages:",
    "  - ca-certificates",
    "  - curl",
    "write_files:",
    `  - path: ${SERVER_DIRECTORY}/docker-compose.yml`,
    '    permissions: "0644"',
    "    content: |",
    indent(composeFileFor(input.version).trimEnd(), 6),
    `  - path: ${SERVER_DIRECTORY}/.env`,
    '    permissions: "0600"',
    "    content: |",
    indent(env.map(([name, value]) => `${name}=${value}`).join("\n"), 6),
    "runcmd:",
    `  - [sh, -c, '${retried("curl -fsSL https://get.docker.com | sh")}']`,
    `  - [sh, -c, '${retried(`docker compose --project-directory ${SERVER_DIRECTORY} up -d`)}']`,
    "",
  ].join("\n");
}
