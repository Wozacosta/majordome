import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { MajordomeTopicsSection } from "./MajordomeTopics";

const state = vi.hoisted(() => ({
  reordered: [] as unknown[],
  opened: [] as string[],
}));
const topic = (id: string) => ({
  id,
  title: `Topic ${id}`,
  folder: `projects/${id}`,
  threadId: null,
  threadEnvironmentId: "env",
  folderExists: true,
  keyNote: null,
});
const vault = {
  key: "vault",
  environmentId: "env",
  projectId: "project",
  title: "Notes",
  brainId: null,
  topics: ["a", "b", "c"].map(topic),
  suggestions: [],
  folders: [],
  projectsFolder: "projects",
  copies: [],
};
vi.mock("./useMajordomeVaults", () => ({
  useMajordomeVaults: () => ({
    vaults: [vault],
    copies: [vault],
    loading: false,
    activeVault: vault,
    setActiveVaultKey: () => {},
  }),
}));
vi.mock("./useOpenTopic", () => ({
  useOpenTopic: () => async (opened: { id: string }) => {
    state.opened.push(opened.id);
    return true;
  },
}));
vi.mock("./useVaultRoutines", () => ({ useVaultRoutines: () => ({ routines: [] }) }));
vi.mock("./TopicDialog", () => ({ TopicDialog: () => null }));
vi.mock("../../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/entities")>()),
  useQuietThreadShells: () => [],
}));
vi.mock("../../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/environments")>()),
  useEnvironments: () => ({ environments: [] }),
}));
vi.mock("../../state/majordome", () => ({ majordomeEnvironment: {} }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async (request: unknown) => {
    state.reordered.push(request);
    return { _tag: "Success" };
  },
}));
vi.mock("../../hooks/useThreadRouteTarget", () => ({ useThreadRouteTarget: () => null }));

function setup() {
  state.reordered = [];
  state.opened = [];
}

const row = (container: HTMLElement, id: string) => {
  const button = container.querySelector<HTMLButtonElement>(`[data-topic-id="${id}"] > button`);
  if (button === null) throw new Error(`no row for topic ${id}`);
  return button;
};
const middle = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
};
const mouse = (type: string, at: { clientX: number; clientY: number }) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at });

it("moves a topic to where it is dragged and keeps it there once saved", async () => {
  setup();
  await using screen = await render(
    <SidebarProvider>
      <MajordomeTopicsSection />
    </SidebarProvider>,
  );
  const first = row(screen.container, "a");
  const start = middle(first);
  const end = middle(row(screen.container, "c"));

  first.dispatchEvent(mouse("mousedown", start));
  document.dispatchEvent(mouse("mousemove", { ...start, clientY: start.clientY + 10 }));
  await vi.waitFor(() => expect(first.parentElement?.className).toContain("shadow-lg"));
  document.dispatchEvent(mouse("mousemove", end));
  // The last topic moves up into the gap before the drop.
  await vi.waitFor(() =>
    expect(middle(row(screen.container, "c")).clientY).toBeLessThan(end.clientY),
  );
  document.dispatchEvent(mouse("mouseup", end));

  await vi.waitFor(() =>
    expect(state.reordered).toEqual([
      { environmentId: "env", input: { projectId: "project", topicIds: ["b", "c", "a"] } },
    ]),
  );
  expect(state.opened).toEqual([]);
  // The save has answered and the list has not been read again: the new order stays on screen.
  await screen.rerender(
    <SidebarProvider>
      <MajordomeTopicsSection />
    </SidebarProvider>,
  );
  expect(
    [...screen.container.querySelectorAll("[data-topic-id]")].map((item) =>
      item.getAttribute("data-topic-id"),
    ),
  ).toEqual(["b", "c", "a"]);
});

it("still opens a topic on a plain click", async () => {
  setup();
  await using screen = await render(
    <SidebarProvider>
      <MajordomeTopicsSection />
    </SidebarProvider>,
  );
  await screen.getByRole("button", { name: /^Topic b/ }).click();
  await vi.waitFor(() => expect(state.opened).toEqual(["b"]));
  expect(state.reordered).toEqual([]);
});
