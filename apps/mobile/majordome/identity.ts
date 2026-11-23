import type { ExpoConfig } from "expo/config";

import { BRAND_ASSET_PATHS } from "../../../scripts/lib/brand-assets.ts";

// Upstream's config keeps upstream's identity so merges stay clean; this turns the finished
// config into Majordome's. The URL schemes stay upstream's: links and pairing codes key on them.
const UPSTREAM_BUNDLE_ID = "com.t3tools.t3code";
const MAJORDOME_BUNDLE_ID = "io.github.wozacosta.majordome.ios";
const MAJORDOME_APPLE_TEAM_ID = "5RDKJ8PDGZ";

// Every variant wears the cloche; upstream's dev and nightly icons are upstream's logo.
const ICONS = [
  [BRAND_ASSET_PATHS.developmentIosIconPng, BRAND_ASSET_PATHS.productionIosIconPng],
  [BRAND_ASSET_PATHS.nightlyIosIconPng, BRAND_ASSET_PATHS.productionIosIconPng],
  [
    BRAND_ASSET_PATHS.developmentIconComposerProject,
    BRAND_ASSET_PATHS.productionIconComposerProject,
  ],
  [BRAND_ASSET_PATHS.nightlyIconComposerProject, BRAND_ASSET_PATHS.productionIconComposerProject],
] as const;

export function withMajordomeIdentity(config: ExpoConfig): ExpoConfig {
  const renamed = JSON.parse(
    ICONS.reduce(
      (text, [upstream, majordome]) => text.replaceAll(upstream, majordome),
      JSON.stringify(config),
    )
      .replaceAll(UPSTREAM_BUNDLE_ID, MAJORDOME_BUNDLE_ID)
      .replaceAll("T3 Code", "Majordome"),
  ) as ExpoConfig;
  const { eas: _eas, ...extra } = renamed.extra ?? {};
  const { owner: _owner, ...rest } = renamed;
  return {
    ...rest,
    slug: "majordome",
    // Updates come as new builds; upstream's update server only knows upstream's app.
    updates: { enabled: false },
    ios: {
      ...renamed.ios,
      appleTeamId: MAJORDOME_APPLE_TEAM_ID,
      // Upstream's domains list upstream's app, not this one.
      associatedDomains: [],
    },
    // Android is not built; its identifiers stay upstream's.
    ...(config.android ? { android: config.android } : {}),
    extra,
  };
}
