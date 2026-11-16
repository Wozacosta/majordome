import type { MajordomeBackupStatus } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { MajordomeSidebarNav } from "./MajordomeSidebarNav";

const state = vi.hoisted(() => ({ backup: [] as unknown[] }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.backup,
}));
vi.mock("../../state/majordome", () => ({ vaultBackupStatusesAtom: () => ({}) }));
vi.mock("../../state/entities", () => ({
  useProjects: () => [],
  useQuietThreadShells: () => [],
}));

const healthy: MajordomeBackupStatus = {
  isVault: true,
  lastSavedAt: null,
  saveError: null,
  paused: null,
  remote: null,
  folder: null,
  drive: null,
  hasPassphrase: false,
  googleDrive: { available: true, signedIn: false },
  github: { available: true, signedIn: false },
  secretScan: true,
};

function setup(statuses: ReadonlyArray<MajordomeBackupStatus>) {
  state.backup = statuses.map((status) => AsyncResult.success(status));
}

const navLinks = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Majordome"] a')].map(
    (link) => [link.textContent, link.getAttribute("href")],
  );

it("lists only Today, Feed, Notes and Routines while backup is fine", async () => {
  setup([healthy]);
  await using screen = await render(
    <SidebarProvider>
      <MajordomeSidebarNav />
    </SidebarProvider>,
  );
  expect(navLinks(screen.container)).toEqual([
    ["Today", "/"],
    ["Feed", "/feed"],
    ["Notes", "/notes"],
    ["Routines", "/routines"],
  ]);
});

it("adds a row leading to Back up my brain while backup is paused", async () => {
  setup([
    healthy,
    { ...healthy, paused: { reason: "conflict", files: [], since: "2026-11-15T00:00:00Z" } },
  ]);
  await using screen = await render(
    <SidebarProvider>
      <MajordomeSidebarNav />
    </SidebarProvider>,
  );
  expect(navLinks(screen.container).at(-1)).toEqual(["Backup paused", "/settings/backup"]);
});
