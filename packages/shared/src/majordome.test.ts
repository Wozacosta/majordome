import { describe, expect, it } from "vite-plus/test";
import { hostedServerName, isT3CodeHome } from "./majordome.ts";

describe("isT3CodeHome", () => {
  it.each([
    ["/Users/alice/.t3", "/Users/alice"],
    ["/Users/alice/.t3/", "/Users/alice"],
    ["/Users/alice/.t3/dev", "/Users/alice"],
    ["/Users/alice/.t3/dev/", "/Users/alice/"],
    ["C:\\Users\\alice\\.t3", "C:\\Users\\alice"],
    ["C:\\Users\\alice\\.t3\\dev\\", "C:\\Users\\alice"],
  ])("refuses %s for home %s", (baseDir, home) => {
    expect(isT3CodeHome(baseDir, home)).toBe(true);
  });

  it.each([
    "/Users/alice/.t3/projects/x",
    "/Users/alice/.t3/worktrees/x/.t3",
    "/Users/alice/.t3/userdata",
    "/Users/alice/.majordome",
    "/Users/alice/.majordome/dev",
    "/Users/bob/.t3",
  ])("allows %s", (baseDir) => {
    expect(isT3CodeHome(baseDir, "/Users/alice")).toBe(false);
  });
});

describe("hostedServerName", () => {
  it("names a server Majordome hosts only when its creation said so", () => {
    expect(hostedServerName({ MAJORDOME_HOSTED: "1" })).toBe("Majordome server");
    expect(hostedServerName({ MAJORDOME_HOSTED: " true " })).toBe("Majordome server");
    expect(hostedServerName({ MAJORDOME_HOSTED: "0" })).toBeNull();
    expect(hostedServerName({})).toBeNull();
  });
});
