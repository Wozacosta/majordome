import type { ExpoConfig } from "expo/config";

import { BRAND_ASSET_PATHS } from "../../../scripts/lib/brand-assets.ts";

// Upstream's config keeps upstream's identity so merges stay clean; this turns the finished
// config into Majordome's, URL scheme included: with both apps on one phone, a link must open
// the one it was made for.
const UPSTREAM_BUNDLE_ID = "com.t3tools.t3code";
const MAJORDOME_BUNDLE_ID = "io.github.wozacosta.majordome.ios";
const MAJORDOME_APPLE_TEAM_ID = "5RDKJ8PDGZ";

// Every variant wears the cloche; upstream's dev and nightly icons are upstream's logo.
const ICONS = [
  [BRAND_ASSET_PATHS.developmentIosIconPng, BRAND_ASSET_PATHS.productionIosIconPng],
  [BRAND_ASSET_PATHS.nightlyIosIconPng, BRAND_ASSET_PATHS.productionIosIconPng],
] as const;

const majordomeScheme = (scheme: string) => scheme.replace(/^t3code/, "majordome");

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
    ...(renamed.scheme === undefined
      ? {}
      : {
          scheme: Array.isArray(renamed.scheme)
            ? renamed.scheme.map(majordomeScheme)
            : majordomeScheme(renamed.scheme),
        }),
    // Updates come as new builds; upstream's update server only knows upstream's app.
    updates: { enabled: false },
    ios: {
      ...renamed.ios,
      // Upstream's Icon Composer projects still draw upstream's logo; the PNG is the cloche.
      icon: renamed.icon,
      appleTeamId: MAJORDOME_APPLE_TEAM_ID,
      // Upstream's domains list upstream's app. Majordome's addresses are under majord.link, whose
      // root names this app (infra/broker), so a server's pairing code opens the app.
      associatedDomains: ["applinks:*.majord.link"],
    },
    // Android is not built; its identifiers stay upstream's.
    ...(config.android ? { android: config.android } : {}),
    extra,
  };
}
