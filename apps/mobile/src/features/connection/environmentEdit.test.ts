import { describe, expect, it } from "vite-plus/test";

import { canSaveEnvironmentEdit } from "./environmentEdit";

const saved = { label: "Studio", displayUrl: "https://k7m2xq9d.majord.link" };

describe("canSaveEnvironmentEdit", () => {
  it("has nothing to save until the name or the address changes", () => {
    expect(canSaveEnvironmentEdit(saved, saved)).toBe(false);
    expect(canSaveEnvironmentEdit(saved, { ...saved, label: " Studio " })).toBe(false);
  });

  it("saves a new name or a new address", () => {
    expect(canSaveEnvironmentEdit(saved, { ...saved, label: "Den" })).toBe(true);
    expect(canSaveEnvironmentEdit(saved, { ...saved, displayUrl: "192.168.1.20:3773" })).toBe(true);
  });

  it("never saves an empty name or address", () => {
    expect(canSaveEnvironmentEdit(saved, { ...saved, label: "  " })).toBe(false);
    expect(canSaveEnvironmentEdit(saved, { label: "Den", displayUrl: "" })).toBe(false);
  });
});
