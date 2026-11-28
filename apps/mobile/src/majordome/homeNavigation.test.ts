import { describe, expect, it, vi } from "vite-plus/test";

import { openToday, todayNavigationState } from "./homeNavigation";

const home = { key: "home-1", name: "Home" };

describe("todayNavigationState", () => {
  it("puts the Today page over the chat list", () => {
    expect(todayNavigationState({ key: "root", index: 0, routes: [home] })).toEqual({
      key: "root",
      index: 1,
      routes: [home, { name: "Today" }],
    });
  });

  it("takes the place of the page that was open, so Back returns to the list", () => {
    const thread = { key: "thread-1", name: "Thread", params: { threadId: "t" } };
    const settings = { key: "settings-1", name: "Settings" };
    expect(
      todayNavigationState({ key: "root", index: 2, routes: [home, settings, thread] }).routes,
    ).toEqual([home, { name: "Today" }]);
  });

  it("keeps a Today page that is already open", () => {
    const today = { key: "today-1", name: "Today" };
    const state = { key: "root", index: 1, routes: [home, today] };
    expect(todayNavigationState(state).routes).toEqual([home, today]);
  });

  it("adds the list under a page opened by a link on its own", () => {
    const today = { key: "today-1", name: "Today" };
    expect(todayNavigationState({ key: "root", index: 0, routes: [today] }).routes).toEqual([
      { name: "Home" },
      today,
    ]);
  });
});

describe("openToday", () => {
  it("resets the root stack, from a screen nested under it", () => {
    const state = { key: "root", index: 0, routes: [home] };
    const dispatch = vi.fn();
    const root = { dispatch, getParent: () => undefined, getState: () => state as never };
    openToday({ dispatch, getParent: () => root, getState: () => undefined });
    expect(dispatch).toHaveBeenCalledWith({
      type: "RESET",
      target: "root",
      payload: { key: "root", index: 1, routes: [home, { name: "Today" }] },
    });
  });
});
