import type { ExpoConfig } from "expo/config";

import { BRAND_ASSET_PATHS } from "../../../scripts/lib/brand-assets.ts";

// Upstream's config keeps upstream's identity so merges stay clean; this turns the finished
// config into Majordome's, URL scheme included: with both apps on one phone, a link must open
// the one it was made for.
const UPSTREAM_BUNDLE_ID = "com.t3tools.t3code";
const MAJORDOME_BUNDLE_ID = "io.github.wozacosta.majordome.ios";
const MAJORDOME_APPLE_TEAM_ID = "5RDKJ8PDGZ";
// The Android name has no platform in it; the suffix a variant adds (.dev, .preview) stays.
const androidPackage = (iosBundleId: string) => iosBundleId.replace(".ios", "");

// Every variant wears the cloche; upstream's dev and nightly icons are upstream's logo.
const ICONS = [
  [BRAND_ASSET_PATHS.developmentIosIconPng, BRAND_ASSET_PATHS.productionIosIconPng],
  [BRAND_ASSET_PATHS.nightlyIosIconPng, BRAND_ASSET_PATHS.productionIosIconPng],
] as const;

// The launch screen shows the cloche alone: the app icon there is a dark square on white.
const SPLASH = {
  light: "./assets/majordome-splash-light.png",
  dark: "./assets/majordome-splash-dark.png",
};

// Upstream's widgets show a coding agent's activity and plan usage, and its Live Activities
// arrive through upstream's relay, which Majordome does not run. Leaving the plugins out leaves
// the extension target out of the build, as upstream's own Personal Team builds already do.
const UPSTREAM_WIDGET_PLUGINS = ["expo-widgets", "./plugins/withWidgetLogoAsset.cjs"];

function withoutUpstreamWidgets(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  return plugins?.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return typeof name !== "string" || !UPSTREAM_WIDGET_PLUGINS.includes(name);
  });
}

function withMajordomeSplash(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  return plugins?.map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== "expo-splash-screen") return plugin;
    const options = (plugin[1] ?? {}) as { readonly dark?: object };
    return [
      plugin[0],
      {
        ...options,
        image: SPLASH.light,
        imageWidth: 132,
        dark: { ...options.dark, image: SPLASH.dark },
      },
    ];
  });
}

// Rendered by `vp run icons:export`. Android masks and tints these, so they are the cloche on a
// clear canvas; upstream's are upstream's logo.
const ANDROID_ICON_BACKGROUND = "#14161c";
const ANDROID_ASSETS = [
  ["./assets/android-icon-foreground.png", "./assets/majordome-android-foreground.png"],
  ["./assets/android-icon-mark.png", "./assets/majordome-android-monochrome.png"],
  ["./assets/android-notification-icon.png", "./assets/majordome-android-notification.png"],
] as const;

function withMajordomeAndroidPlugins(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  return plugins?.map((plugin) => {
    if (!Array.isArray(plugin)) return plugin;
    const [name, options] = plugin;
    if (name === "expo-splash-screen") {
      return [
        name,
        {
          ...options,
          android: {
            image: "./assets/majordome-android-splash-light.png",
            imageWidth: 288,
            dark: { image: "./assets/majordome-android-splash-dark.png" },
          },
        },
      ];
    }
    if (name === "expo-notifications") return [name, { ...options, color: "#3ddc84" }];
    if (name === "expo-quick-actions") {
      const foregroundImage = options?.androidIcons?.shortcut_icon?.foregroundImage;
      return [
        name,
        {
          ...options,
          androidIcons: {
            shortcut_icon: { foregroundImage, backgroundColor: ANDROID_ICON_BACKGROUND },
          },
        },
      ];
    }
    return plugin;
  });
}

// One sentence for both uses of the camera: upstream's only names the pairing code.
const CAMERA_USE =
  "Majordome uses the camera to scan a pairing code and to take a photo you add to a chat.";

function withMajordomeCameraUse(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  return plugins?.map((plugin) =>
    Array.isArray(plugin) && plugin[0] === "expo-camera"
      ? [plugin[0], { ...plugin[1], cameraPermission: CAMERA_USE }]
      : plugin,
  );
}

const majordomeScheme = (scheme: string) => scheme.replace(/^t3code/, "majordome");

export function withMajordomeIdentity(config: ExpoConfig): ExpoConfig {
  const renamed = JSON.parse(
    [...ICONS, ...ANDROID_ASSETS]
      .reduce(
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
    plugins: [
      ...(withMajordomeAndroidPlugins(
        withMajordomeCameraUse(withoutUpstreamWidgets(withMajordomeSplash(renamed.plugins))),
      ) ?? []),
      "./plugins/withMajordomeAndroidSigning.cjs",
    ],
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
    android: {
      ...renamed.android,
      ...(renamed.android?.package ? { package: androidPackage(renamed.android.package) } : {}),
      // Android only installs over an app with a lower number; the release script counts up.
      ...(process.env.MAJORDOME_ANDROID_VERSION_CODE
        ? { versionCode: Number(process.env.MAJORDOME_ANDROID_VERSION_CODE) }
        : {}),
      adaptiveIcon: {
        foregroundImage: renamed.android?.adaptiveIcon?.foregroundImage,
        monochromeImage: renamed.android?.adaptiveIcon?.monochromeImage,
        backgroundColor: ANDROID_ICON_BACKGROUND,
      },
      // Upstream's filter opens links to upstream's hosted app. A Majordome address is a
      // person's own server, and opening it in the app needs a signed release to vouch for.
      intentFilters: [],
    },
    // Upstream's build project is left out, but on Android the crash reporter refuses to start
    // without one. It sends nothing here (observe.ts turns it off), so an empty id serves.
    extra: { ...extra, eas: { projectId: "00000000-0000-0000-0000-000000000000" } },
  };
}
