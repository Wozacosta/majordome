import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, ""],
  ["development", ".dev"],
  ["preview", ".preview"],
  ["production", ""],
])("takes Majordome's iOS identity for APP_VARIANT=%j", async (value, suffix) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(`io.github.wozacosta.majordome.ios${suffix}`);
  expect(config.ios?.appleTeamId).toBe("5RDKJ8PDGZ");
  // Its own link scheme, so a link never opens upstream's app on a phone that has both.
  expect(config.scheme).toBe(`majordome${suffix.replace(".", "-")}`);
  expect(config.ios?.icon).toBe("../../assets/prod/black-ios-1024.png");
  // Upstream's domains and update server only know upstream's app.
  expect(config.ios?.associatedDomains).toEqual(["applinks:*.majord.link"]);
  expect(config.updates).toEqual({ enabled: false });
  expect(config.android?.package).toBe(`com.t3tools.t3code${suffix}`);
  const { android: _android, ...shown } = config;
  expect(JSON.stringify(shown)).not.toMatch(/T3 Code|t3tools/);
});
