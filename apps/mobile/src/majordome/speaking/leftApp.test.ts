import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "android" } }));

import { createLeftAppWatcher } from "./leftApp";

function setup(graceMs: number) {
  const left = vi.fn();
  let pending: (() => void) | null = null;
  const watcher = createLeftAppWatcher(left, graceMs, (callback) => {
    pending = callback;
    return () => {
      pending = null;
    };
  });
  return { left, watcher, elapse: () => pending?.() };
}

describe("leaving the app during a conversation", () => {
  it("ends it at once where the background is always a real exit", () => {
    const { left, watcher } = setup(0);
    watcher.state("inactive");
    expect(left).not.toHaveBeenCalled();
    watcher.state("background");
    expect(left).toHaveBeenCalledOnce();
  });

  it("forgives an Android pause the user comes straight back from", () => {
    const { left, watcher, elapse } = setup(1_000);
    watcher.state("background");
    watcher.state("active");
    elapse();
    expect(left).not.toHaveBeenCalled();
  });

  it("ends it when the Android pause lasts", () => {
    const { left, watcher, elapse } = setup(1_000);
    watcher.state("background");
    watcher.state("background");
    elapse();
    expect(left).toHaveBeenCalledOnce();
  });

  it("drops a pending exit when the conversation closes first", () => {
    const { left, watcher, elapse } = setup(1_000);
    watcher.state("background");
    watcher.stop();
    elapse();
    expect(left).not.toHaveBeenCalled();
  });
});
