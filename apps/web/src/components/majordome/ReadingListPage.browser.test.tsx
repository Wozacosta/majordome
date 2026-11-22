import type { MajordomeReadingItem } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { ReadingListPage } from "./ReadingListPage";

const state = vi.hoisted(() => ({
  commands: [] as Array<readonly [string, unknown]>,
  // The last one is snoozed for good: out of the list, folded under it.
  items: ["a", "b", "c", "z"].map((id): MajordomeReadingItem => ({
    id,
    url: `https://example.com/${id}`,
    title: `Link ${id}`,
    kind: "article",
    tags: [],
    addedAt: "2026-11-06T12:00:00.000Z",
    ...(id === "z" ? { snoozedUntil: "2999-01-01" } : {}),
  })),
}));
const setup = () => {
  state.commands = [];
  localStorage.removeItem("majordome:reading-list-view");
};
const sent = (itemId: string, change: Record<string, unknown>) => [
  "update",
  { environmentId: "env", input: { projectId: "project", itemId, ...change } },
];
const vault = { key: "vault", environmentId: "env", projectId: "project" };

vi.mock("./useMajordomeVaults", () => ({
  useMajordomeVaults: () => ({ activeVault: vault, loading: false }),
}));
vi.mock("./AssistantDock", () => ({ useAskAssistant: () => null }));
vi.mock("../../state/majordome", () => {
  const command = (name: string) => ({ name, permissionAtom: () => "permission" });
  return {
    majordomeEnvironment: {
      readingItems: () => "list",
      addReadingItem: command("add"),
      updateReadingItem: command("update"),
      reorderReadingItems: command("reorder"),
      removeReadingItem: command("remove"),
      restoreReadingItem: command("restore"),
    },
  };
});
vi.mock("@effect/atom-react", async (importOriginal) => {
  const { AsyncResult } = await import("effect/reactivity");
  const list = AsyncResult.success({ isVault: true, items: state.items });
  return {
    ...(await importOriginal<typeof import("@effect/atom-react")>()),
    useAtomValue: (atom: unknown) => (atom === "list" ? list : true),
    useAtomRefresh: () => () => {},
  };
});
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly name: string }) => async (request: unknown) => {
    state.commands.push([command.name, request]);
    return { _tag: "Success", value: { item: state.items[0], duplicate: false } };
  },
}));

const readingPage = (
  <SidebarProvider>
    <ReadingListPage />
  </SidebarProvider>
);
const handle = (container: HTMLElement, id: string) => {
  const button = container.querySelector<HTMLButtonElement>(`[data-reading-id="${id}"] button`);
  if (button === null) throw new Error(`no handle for ${id}`);
  return button;
};
const middle = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
};
const mouse = (type: string, at: { clientX: number; clientY: number }) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at });

it("saves what is typed on Enter and marks a row finished from its checkbox", async () => {
  setup();
  await using screen = await render(readingPage);

  const field = screen.getByRole("textbox", { name: "Paste a link or type a title" });
  await userEvent.type(field, "https://example.com/new{Enter}");
  await vi.waitFor(() =>
    expect(state.commands).toEqual([
      [
        "add",
        { environmentId: "env", input: { projectId: "project", text: "https://example.com/new" } },
      ],
      // The saved link is then handed to the owner's AI for its tags and summary.
      [
        "update",
        { environmentId: "env", input: { projectId: "project", itemId: "a", enrich: true } },
      ],
    ]),
  );
  await expect.element(field).toHaveValue("");

  await screen.getByRole("checkbox", { name: "Finished: Link b" }).click();
  await vi.waitFor(() =>
    expect(state.commands[2]).toEqual([
      "update",
      { environmentId: "env", input: { projectId: "project", itemId: "b", done: true } },
    ]),
  );
});

it("moves a row to where it is dragged and keeps it there once saved", async () => {
  setup();
  await using screen = await render(readingPage);
  const first = handle(screen.container, "a");
  const start = middle(first);
  const end = middle(handle(screen.container, "c"));

  first.dispatchEvent(mouse("mousedown", start));
  document.dispatchEvent(mouse("mousemove", { ...start, clientY: start.clientY + 10 }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[data-reading-id='a'][data-dragging]")).not.toBeNull(),
  );
  document.dispatchEvent(mouse("mousemove", end));
  // The last row moves up into the gap before the drop.
  await vi.waitFor(() =>
    expect(middle(handle(screen.container, "c")).clientY).toBeLessThan(end.clientY),
  );
  document.dispatchEvent(mouse("mouseup", end));

  await vi.waitFor(() =>
    expect(state.commands).toEqual([
      [
        "reorder",
        { environmentId: "env", input: { projectId: "project", itemIds: ["b", "c", "a", "z"] } },
      ],
    ]),
  );
  // The save has answered and the list has not been read again: the new order stays on screen.
  await screen.rerender(
    <SidebarProvider>
      <ReadingListPage />
    </SidebarProvider>,
  );
  expect(
    [...screen.container.querySelectorAll("[data-reading-id]")].map((row) =>
      row.getAttribute("data-reading-id"),
    ),
  ).toEqual(["b", "c", "a"]);
});

it("offers the first things as Next, and snoozes, wakes and changes the kind of a row", async () => {
  setup();
  await using screen = await render(readingPage);

  await screen.getByRole("button", { name: "Next", exact: true }).click();
  const cards = screen.getByRole("list", { name: "Next on your list" }).getByRole("listitem");
  await expect.element(cards.nth(2).getByRole("link", { name: "Link c" })).toBeVisible();
  expect(cards.elements()).toHaveLength(3);
  await cards.first().getByRole("button", { name: "Not now" }).click();
  await vi.waitFor(() =>
    expect(state.commands).toEqual([
      sent("a", { snoozedUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    ]),
  );

  await screen.getByRole("button", { name: "Everything" }).click();
  await screen.getByRole("button", { name: "Snoozed (1)" }).click();
  await expect.element(screen.getByText("back on Tue 1 Jan 2999")).toBeVisible();
  await screen.getByRole("button", { name: "More for Link z" }).click();
  await screen.getByRole("menuitem", { name: "Wake it now" }).click();
  await vi.waitFor(() => expect(state.commands[1]).toEqual(sent("z", { snoozedUntil: null })));

  await screen.getByRole("button", { name: "More for Link b" }).click();
  await screen.getByRole("menuitem", { name: "Change kind" }).click();
  await screen.getByRole("menuitemradio", { name: "Video" }).click();
  await vi.waitFor(() => expect(state.commands[2]).toEqual(sent("b", { kind: "video" })));
});
