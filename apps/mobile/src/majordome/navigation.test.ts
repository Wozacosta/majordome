import type {
  NavigationState,
  ParamListBase,
  StackNavigationState,
} from "@react-navigation/native";
import { describe, expect, it } from "vite-plus/test";

import {
  workspaceTabColumns,
  workspaceTabNavigationState,
} from "../features/layout/workspace/workspace-tab-navigation";
import {
  initialWorkspaceTabsState,
  resolveWorkspaceTabOrder,
} from "../features/layout/workspace/workspace-tabs-state";
import {
  leaveSettingsPage,
  settingsNavigationState,
} from "../features/settings/settings-navigation";
import { androidWorkspaceDestinationAnimation } from "../lib/android-workspace-navigation";
import {
  collapsedSplitTransition,
  nativeStackPopAction,
  projectWorkspaceStack,
} from "../native/workspace-stack-projection";

// Majordome has no tab bar: the chat list is the root, and Today and Settings are pages over it.

const home = { key: "home", name: "Home" };
const settings = { key: "settings", name: "Settings" };
const voice = { key: "voice", name: "SettingsVoice" };
const today = { key: "today", name: "Today" };
const thread = {
  key: "thread",
  name: "Thread",
  params: { environmentId: "env", threadId: "thread-a" },
};
const available = { thread: () => true, pullRequest: () => true, issue: () => true };
const history = (routes: readonly { readonly key: string; readonly name: string }[]) =>
  ({
    key: "root",
    index: routes.length - 1,
    routes,
    routeNames: [],
    type: "stack",
    stale: false,
    preloadedRoutes: [],
  }) as unknown as StackNavigationState<ParamListBase>;
const names = (state: { readonly routes: readonly { readonly name: string }[] }) =>
  state.routes.map((route) => route.name);

describe("the root with no tabs", () => {
  it("has the chat list as its only tab, whatever order was saved", () => {
    expect(resolveWorkspaceTabOrder(undefined)).toEqual(["threads"]);
    expect(resolveWorkspaceTabOrder(["usage", "issues", "threads"])).toEqual(["threads"]);
  });

  it("opens on the chat list", () => {
    expect(initialWorkspaceTabsState().selectedTab).toBe("threads");
  });
});

describe("Settings as a page", () => {
  it("opens as the list over Home, on phones and beside the chat list alike", () => {
    for (const platform of ["ios", "android"]) {
      for (const wide of [false, true]) {
        const state = workspaceTabNavigationState(
          { routes: [home, thread] },
          "settings",
          { settings: "SettingsVoice" },
          { columns: workspaceTabColumns(platform, "settings", wide), check: available },
        );
        expect(names(state)).toEqual(["Home", "Settings"]);
        expect(state.index).toBe(1);
      }
    }
  });

  it("still reopens the last chat beside the list on a wide iPhone or iPad", () => {
    expect(workspaceTabColumns("ios", "threads", true)).toBe(true);
  });

  it("is a page of the stack, with its own pages above it", () => {
    expect(projectWorkspaceStack(history([home, settings, voice]), () => false)).toEqual({
      primary: home,
      detail: [settings, voice],
      overlays: [],
    });
  });

  it("goes back from a page to the list, then from the list to the chats", () => {
    const open = history([home, settings, voice]);
    expect(nativeStackPopAction(open, voice.key, settings.key)).toMatchObject({
      payload: { count: 1 },
    });
    expect(nativeStackPopAction(history([home, settings]), settings.key, home.key)).toMatchObject({
      payload: { count: 1 },
    });
  });

  it("returns to the chats when a collapsed split pops the Settings list", () => {
    const state = history([home, settings]);
    const leaving = collapsedSplitTransition(
      { visible: "secondary", leaving: null },
      { type: "willDisappear", key: settings.key },
      state,
      home.key,
    );
    expect(
      collapsedSplitTransition(
        leaving.column,
        { type: "didAppear", key: home.key },
        state,
        home.key,
      ).pop,
    ).toMatchObject({ type: "POP", payload: { count: 1 }, source: settings.key });
  });

  it("keeps the list under a page opened by name", () => {
    expect(names(settingsNavigationState({ routes: [home, today] }, "SettingsVoice"))).toEqual([
      "Home",
      "Settings",
      "SettingsVoice",
    ]);
  });

  it("leaves a finished page by going back to the list, with columns too", () => {
    const state = history([home, settings, voice]) as unknown as NavigationState;
    let wentBack = 0;
    const resets: unknown[] = [];
    leaveSettingsPage(
      {
        dispatch: (action) => resets.push(action),
        getParent: () => undefined,
        getState: () => state,
        goBack: () => {
          wentBack += 1;
        },
      },
      true,
      "SettingsEnvironments",
    );
    expect(wentBack).toBe(1);
    expect(resets).toEqual([]);
  });
});

describe("pages beside the chat list on a wide Android window", () => {
  const routes = [home, settings, voice];

  it("swaps Today and the Settings list in like a chat, and fades Settings pages", () => {
    expect(androidWorkspaceDestinationAnimation(today, [home, today], true)).toBe("none");
    expect(androidWorkspaceDestinationAnimation(settings, routes, true)).toBe("none");
    expect(androidWorkspaceDestinationAnimation(voice, routes, true)).toBe("fade");
  });

  it("slides them in on a phone", () => {
    expect(androidWorkspaceDestinationAnimation(today, [home, today], false)).toBe(undefined);
    expect(androidWorkspaceDestinationAnimation(settings, routes, false)).toBe(undefined);
    expect(androidWorkspaceDestinationAnimation(voice, routes, false)).toBe(undefined);
  });
});
