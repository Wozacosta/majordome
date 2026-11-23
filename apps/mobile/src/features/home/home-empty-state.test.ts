import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../majordome/env", () => ({ isMajordome: false, MAJORDOME_HIDDEN_TABS: [] }));

import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";
import { deriveHomeEmptyState } from "./home-empty-state";

function connectingEnvironment(
  connectionState: "connecting" | "reconnecting",
  connectionError: string | null,
): WorkspaceEnvironment {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    environmentLabel: "corex",
    displayUrl: "",
    isRelayManaged: false,
    isEnabled: true,
    connectionState,
    connectionError,
    connectionErrorTraceId: null,
  };
}

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasSyncingConnectedEnvironment: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    networkStatus: "online",
    ...overrides,
  };
}

const RETAINED_FAILURE = "Environment did not respond before the connection timeout.";
const reconnecting = connectingEnvironment("reconnecting", RETAINED_FAILURE);

describe("home empty state", () => {
  it.each([
    [
      "waits while a saved environment retries after a retained failure",
      workspaceState({
        hasLoadedShellSnapshot: false,
        hasPendingShellSnapshot: true,
        hasReadyEnvironment: false,
        hasConnectingEnvironment: true,
        connectingEnvironments: [reconnecting],
        connectionState: "reconnecting",
        connectionError: RETAINED_FAILURE,
      }),
      1,
      { title: "Connecting to environment", loading: true, showsAddEnvironment: false },
    ],
    [
      "waits for a connected environment's first shell snapshot",
      workspaceState({
        hasLoadedShellSnapshot: false,
        hasPendingShellSnapshot: true,
        hasSyncingConnectedEnvironment: true,
      }),
      0,
      { title: "Loading threads", loading: true, showsAddEnvironment: false },
    ],
    [
      "waits while another environment is still connecting after one loaded empty",
      workspaceState({
        hasPendingShellSnapshot: true,
        hasConnectingEnvironment: true,
        connectingEnvironments: [reconnecting],
        connectionError: RETAINED_FAILURE,
      }),
      0,
      { title: "Loading threads", loading: true, showsAddEnvironment: false },
    ],
    [
      "reports no threads once every environment has resolved",
      workspaceState(),
      1,
      { title: "No threads yet", loading: false, showsAddEnvironment: false },
    ],
    [
      "does not wait on retries while the device is offline",
      workspaceState({
        hasPendingShellSnapshot: true,
        hasReadyEnvironment: false,
        hasConnectingEnvironment: true,
        connectingEnvironments: [reconnecting],
        connectionState: "offline",
        networkStatus: "offline",
      }),
      1,
      { title: "No threads yet", loading: false, showsAddEnvironment: true },
    ],
  ] as const)("%s", (_name, state, projectCount, expected) => {
    const { title, loading, showsAddEnvironment } = deriveHomeEmptyState(state, projectCount);
    expect({ title, loading, showsAddEnvironment }).toEqual(expected);
  });

  it.each([
    [
      "error",
      "The saved environment is offline. Check the URL or start the environment, then retry.",
    ],
    ["unsupported", "Use compatible versions of the app and server to connect."],
  ] as const)(
    "says what to do instead of the %s connection's own text",
    (connectionState, detail) => {
      const state = workspaceState({
        hasLoadedShellSnapshot: false,
        hasReadyEnvironment: false,
        connectionState,
        connectionError: "ECONNREFUSED 100.64.0.1:3773",
      });
      expect(deriveHomeEmptyState(state, 0, undefined, true).detail).toBe(detail);
      expect(deriveHomeEmptyState(state, 0, undefined, false).detail).toBe(
        "ECONNREFUSED 100.64.0.1:3773",
      );
    },
  );
});
