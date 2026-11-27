#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import sharp from "sharp";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

// Tokens the master SVGs are drawn with; each tile swaps them for its own colors.
const MASTER_INK = "#14161c";
const MASTER_LIVE = "#3ddc84";
const MASTER_HIGHLIGHT = "#ffffff";

const PALETTE = { ink: "#14161c", cream: "#f4efe6", live: "#3ddc84" } as const;

// Below this size the 16px-grid mark replaces the master; below DETAIL_SIZE the
// dome highlight, knob glow and nightly stars turn to mud, so they are dropped.
const SMALL_MARK_MAX_SIZE = 32;
const DETAIL_SIZE = 128;
// Share of the tile (or macOS body) taken by the master's 40-unit box.
const MARK_SCALE = 0.66;
// Apple's pre-Tahoe macOS grid: an 824pt body inset 100pt in a 1024pt canvas.
const MAC_BODY_INSET = 100;
const MAC_BODY_SIZE = 824;

type Shape = "square" | "rounded" | "mac";

interface TileStyle {
  readonly background: readonly [top: string, bottom: string];
  readonly dome: readonly [top: string, bottom: string];
  readonly knob: string;
  readonly highlight: string;
  // Points in the unit square of the tile body: [x, y, radius].
  readonly stars?: ReadonlyArray<readonly [number, number, number]>;
}

const TILE_STYLES = {
  production: {
    background: ["#1f222b", PALETTE.ink],
    dome: ["#fbf8f2", "#e8e0d1"],
    knob: PALETTE.live,
    highlight: PALETTE.ink,
  },
  development: {
    background: ["#f8f4ed", "#ebe3d5"],
    dome: ["#2a2d38", PALETTE.ink],
    knob: PALETTE.live,
    highlight: PALETTE.cream,
  },
  nightly: {
    background: ["#2c3474", "#11152f"],
    dome: ["#fbf8f2", "#e8e0d1"],
    knob: PALETTE.live,
    highlight: "#1a1f45",
    stars: [
      [0.19, 0.17, 0.011],
      [0.81, 0.14, 0.008],
      [0.88, 0.31, 0.005],
      [0.12, 0.33, 0.006],
      [0.69, 0.08, 0.004],
    ],
  },
} as const satisfies Record<string, TileStyle>;

type Variant = keyof typeof TILE_STYLES;

interface VariantOutputs {
  readonly ios: string;
  readonly macos: string;
  readonly universal: string;
  readonly appleTouch: string;
  readonly webIcon192: string;
  readonly webIcon512: string;
  readonly favicon16: string;
  readonly favicon32: string;
  readonly faviconIco: string;
  readonly windowsIco: string;
}

const VARIANT_OUTPUTS = {
  development: {
    ios: BRAND_ASSET_PATHS.developmentIosIconPng,
    macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    webIcon192: BRAND_ASSET_PATHS.developmentWebIcon192Png,
    webIcon512: BRAND_ASSET_PATHS.developmentWebIcon512Png,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
  },
  nightly: {
    ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
    macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    webIcon192: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
    webIcon512: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
  },
  production: {
    ios: BRAND_ASSET_PATHS.productionIosIconPng,
    macos: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    webIcon192: BRAND_ASSET_PATHS.productionWebIcon192Png,
    webIcon512: BRAND_ASSET_PATHS.productionWebIcon512Png,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
  },
} as const satisfies Record<Variant, VariantOutputs>;

interface MasterMarks {
  readonly cloche: string;
  readonly clocheSmall: string;
}

export class IconExportFileSystemError extends Schema.TaggedError<IconExportFileSystemError>()(
  "IconExportFileSystemError",
  {
    operation: Schema.Literals(["read-file", "write-file"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Icon export file-system operation '${this.operation}' failed for ${this.path}.`;
  }
}

export class IconExportRenderError extends Schema.TaggedError<IconExportRenderError>()(
  "IconExportRenderError",
  {
    output: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to render ${this.output}.`;
  }
}

export class IconExportAssetsStaleError extends Schema.TaggedError<IconExportAssetsStaleError>()(
  "IconExportAssetsStaleError",
  {
    paths: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Generated icon assets are stale:\n${this.paths.map((path) => `- ${path}`).join("\n")}`;
  }
}

const svgBody = (svg: string) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const knobCircle = (svg: string) => {
  const match = /<circle id="knob" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(svg);
  if (!match) throw new Error('Master cloche needs a <circle id="knob" cx cy r>.');
  return { cx: Number(match[1]), cy: Number(match[2]), r: Number(match[3]) };
};

// Straight sides with superellipse corners: Apple's continuous-corner shape, whose
// curve starts ~1.53 radii from the corner and cuts the diagonal like a 22.37% radius.
const squirclePath = (x: number, y: number, size: number) => {
  const reach = size * 0.342;
  const exponent = 2 / 3.26;
  const steps = 48;
  const corners = [
    [x + size - reach, y + size - reach, 1, 1],
    [x + reach, y + size - reach, -1, 1],
    [x + reach, y + reach, -1, -1],
    [x + size - reach, y + reach, 1, -1],
  ] as const;
  const points = corners.flatMap(([cx, cy, sx, sy], corner) =>
    Array.from({ length: steps + 1 }, (_, index) => {
      const angle = ((corner + index / steps) * Math.PI) / 2;
      const px = cx + sx * reach * Math.abs(Math.cos(angle)) ** exponent;
      const py = cy + sy * reach * Math.abs(Math.sin(angle)) ** exponent;
      return `${px.toFixed(2)} ${py.toFixed(2)}`;
    }),
  );
  return `M${points.join("L")}Z`;
};

const markSvg = (
  marks: MasterMarks,
  style: TileStyle,
  options: { readonly small: boolean; readonly detail: boolean },
  box: { readonly x: number; readonly y: number; readonly size: number },
) => {
  const master = options.small ? marks.clocheSmall : marks.cloche;
  const viewBox = options.small ? 16 : 40;
  let body = svgBody(master)
    .replaceAll(MASTER_INK, "url(#tile-metal)")
    .replaceAll(MASTER_LIVE, style.knob)
    .replaceAll(MASTER_HIGHLIGHT, style.highlight);
  if (!options.detail) body = body.replace(/<path id="highlight"[^>]*\/>/, "");
  const knob = knobCircle(master);
  const glow = options.detail
    ? `<circle cx="${knob.cx}" cy="${knob.cy}" r="${knob.r * 3.2}" fill="url(#tile-glow)"/>`
    : "";
  return `<svg x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" viewBox="0 0 ${viewBox} ${viewBox}" overflow="visible">${glow}${body}</svg>`;
};

/** One tile as SVG, drawn on a 1024 canvas (16 for small marks) and rendered at `size`. */
const tileSvg = (marks: MasterMarks, variant: Variant, shape: Shape, size: number): string => {
  const style: TileStyle = TILE_STYLES[variant];
  const small = size <= SMALL_MARK_MAX_SIZE && shape !== "mac";
  const detail = size >= DETAIL_SIZE;
  const canvas = small ? 16 : 1024;

  let bodyX = 0;
  let bodySize = canvas;
  let clip: string;
  let shadow = "";
  if (shape === "mac") {
    bodyX = MAC_BODY_INSET;
    bodySize = MAC_BODY_SIZE;
    const path = squirclePath(bodyX, bodyX, bodySize);
    clip = `<path d="${path}"/>`;
    shadow = `<filter id="tile-shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="12"/></filter><path d="${path}" transform="translate(0 12)" fill="#000" fill-opacity="0.3" filter="url(#tile-shadow)"/>`;
  } else if (shape === "rounded") {
    // Large Windows/Linux tiles keep a little air; favicons use the whole canvas.
    const margin = size >= 48 ? canvas * 0.0625 : 0;
    bodyX = margin;
    bodySize = canvas - margin * 2;
    clip = `<rect x="${bodyX}" y="${bodyX}" width="${bodySize}" height="${bodySize}" rx="${bodySize * 0.225}"/>`;
  } else {
    clip = `<rect width="${canvas}" height="${canvas}"/>`;
  }

  const markBox = small
    ? { x: bodyX, y: bodyX, size: bodySize }
    : {
        x: bodyX + (bodySize * (1 - MARK_SCALE)) / 2,
        y: bodyX + (bodySize * (1 - MARK_SCALE)) / 2,
        size: bodySize * MARK_SCALE,
      };
  const stars =
    detail && style.stars
      ? style.stars
          .map(
            ([x, y, r]) =>
              `<circle cx="${bodyX + x * bodySize}" cy="${bodyX + y * bodySize}" r="${r * bodySize}" fill="${PALETTE.cream}" fill-opacity="0.75"/>`,
          )
          .join("")
      : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${canvas} ${canvas}">`,
    "<defs>",
    `<linearGradient id="tile-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${style.background[0]}"/><stop offset="1" stop-color="${style.background[1]}"/></linearGradient>`,
    `<linearGradient id="tile-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${style.dome[0]}"/><stop offset="1" stop-color="${style.dome[1]}"/></linearGradient>`,
    `<radialGradient id="tile-glow"><stop offset="0" stop-color="${style.knob}" stop-opacity="0.55"/><stop offset="1" stop-color="${style.knob}" stop-opacity="0"/></radialGradient>`,
    `<clipPath id="tile-body">${clip}</clipPath>`,
    "</defs>",
    shadow,
    `<g clip-path="url(#tile-body)"><rect width="${canvas}" height="${canvas}" fill="url(#tile-bg)"/>${stars}</g>`,
    markSvg(marks, style, { small, detail }, markBox),
    "</svg>",
  ].join("");
};

// Full-bleed squares are masked by the OS, and App Store icons must not carry alpha.
const rasterize = (svg: string, output: string, opaque: boolean) =>
  Effect.tryPromise({
    try: () => {
      const image = sharp(Buffer.from(svg));
      return (opaque ? image.removeAlpha() : image).png({ compressionLevel: 9 }).toBuffer();
    },
    catch: (cause) => new IconExportRenderError({ output, cause }),
  });

const renderVariant = Effect.fn("iconExport.renderVariant")(function* (
  marks: MasterMarks,
  variant: Variant,
) {
  const outputs = VARIANT_OUTPUTS[variant];
  const render = (shape: Shape, size: number, output: string) =>
    rasterize(tileSvg(marks, variant, shape, size), output, shape === "square");

  const icoRenditions = yield* Effect.forEach(WINDOWS_ICON_SIZES, (size) =>
    render("rounded", size, outputs.windowsIco).pipe(
      Effect.map((contents) => ({ size, contents })),
    ),
  );
  const ico = encodePngIco(icoRenditions);

  return new Map<string, Buffer>([
    [outputs.ios, yield* render("square", 1024, outputs.ios)],
    [outputs.macos, yield* render("mac", 1024, outputs.macos)],
    [outputs.universal, yield* render("rounded", 1024, outputs.universal)],
    [outputs.appleTouch, yield* render("square", 180, outputs.appleTouch)],
    [outputs.webIcon192, yield* render("square", 192, outputs.webIcon192)],
    [outputs.webIcon512, yield* render("square", 512, outputs.webIcon512)],
    [outputs.favicon16, yield* render("rounded", 16, outputs.favicon16)],
    [outputs.favicon32, yield* render("rounded", 32, outputs.favicon32)],
    [outputs.faviconIco, ico],
    [outputs.windowsIco, ico],
  ]);
});

// The phone app's Android pieces, drawn on a clear canvas: the launcher masks and tints them.
const ANDROID_ASSETS = "apps/mobile/assets";
const WHITE = { ink: "#ffffff", live: "#ffffff", highlight: null } as const;

const bareMarkSvg = (
  marks: MasterMarks,
  colors: { readonly ink: string; readonly live: string; readonly highlight: string | null },
  options: { readonly size: number; readonly scale: number; readonly small?: boolean },
) => {
  const master = options.small ? marks.clocheSmall : marks.cloche;
  const viewBox = options.small ? 16 : 40;
  const inset = (options.size * (1 - options.scale)) / 2;
  const box = options.size * options.scale;
  let body = svgBody(master)
    .replaceAll(MASTER_INK, colors.ink)
    .replaceAll(MASTER_LIVE, colors.live);
  body =
    colors.highlight === null
      ? body.replace(/<path id="highlight"[^>]*\/>/, "")
      : body.replaceAll(MASTER_HIGHLIGHT, colors.highlight);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}"><svg x="${inset}" y="${inset}" width="${box}" height="${box}" viewBox="0 0 ${viewBox} ${viewBox}">${body}</svg></svg>`;
};

const renderAndroid = Effect.fn("iconExport.renderAndroid")(function* (marks: MasterMarks) {
  const cream = { ink: PALETTE.cream, live: PALETTE.live, highlight: PALETTE.ink };
  const ink = { ink: PALETTE.ink, live: PALETTE.live, highlight: "#ffffff" };
  // An adaptive icon shows the middle 66 of its 108 units; a launch icon the middle two thirds.
  const outputs = [
    ["majordome-android-foreground.png", bareMarkSvg(marks, cream, { size: 432, scale: 0.52 })],
    ["majordome-android-monochrome.png", bareMarkSvg(marks, WHITE, { size: 432, scale: 0.52 })],
    [
      "majordome-android-notification.png",
      bareMarkSvg(marks, WHITE, { size: 96, scale: 1, small: true }),
    ],
    ["majordome-android-splash-light.png", bareMarkSvg(marks, ink, { size: 1152, scale: 0.44 })],
    ["majordome-android-splash-dark.png", bareMarkSvg(marks, cream, { size: 1152, scale: 0.44 })],
  ] as const;
  return yield* Effect.forEach(outputs, ([name, svg]) => {
    const output = `${ANDROID_ASSETS}/${name}`;
    return rasterize(svg, output, false).pipe(
      Effect.map((contents) => [output, contents] as const),
    );
  });
});

export const exportBrandIcons = Effect.fn("exportBrandIcons")(function* (checkOnly: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const readMaster = (relativePath: string) =>
    fs
      .readFileString(path.join(repositoryRoot, relativePath))
      .pipe(
        Effect.mapError(
          (cause) =>
            new IconExportFileSystemError({ operation: "read-file", path: relativePath, cause }),
        ),
      );
  const marks: MasterMarks = {
    cloche: yield* readMaster(BRAND_ASSET_PATHS.clocheSvg),
    clocheSmall: yield* readMaster(BRAND_ASSET_PATHS.clocheSmallSvg),
  };

  const generated = new Map<string, Buffer>();
  for (const variant of Object.keys(TILE_STYLES) as Array<Variant>) {
    yield* Console.log(`Rendering ${variant} icons...`);
    for (const [relativePath, contents] of yield* renderVariant(marks, variant)) {
      generated.set(relativePath, contents);
    }
  }
  for (const [relativePath, contents] of yield* renderAndroid(marks)) {
    generated.set(relativePath, contents);
  }
  // The project favicon resolver shows this vector tile at sidebar size, so it uses the small mark.
  generated.set(
    BRAND_ASSET_PATHS.repositoryIconSvg,
    Buffer.from(
      `${tileSvg(marks, "production", "rounded", 16).replace(/ width="16" height="16"/, "")}\n`,
    ),
  );
  for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
    const contents = generated.get(override.sourceRelativePath);
    if (contents === undefined) {
      return yield* Effect.die(
        new Error(`Generated development web icon is missing: ${override.sourceRelativePath}`),
      );
    }
    generated.set(override.targetRelativePath, contents);
  }

  if (checkOnly) {
    const stale = yield* Effect.filter(
      [...generated.entries()],
      ([relativePath, contents]) =>
        fs.readFile(path.join(repositoryRoot, relativePath)).pipe(
          Effect.map((actual) => !Buffer.from(actual).equals(contents)),
          Effect.orElseSucceed(() => true),
        ),
      { concurrency: "unbounded" },
    );
    if (stale.length > 0) {
      return yield* new IconExportAssetsStaleError({
        paths: stale.map(([relativePath]) => relativePath),
      });
    }
    yield* Console.log(`All ${generated.size} generated icon assets are current.`);
    return;
  }

  yield* Effect.forEach(
    generated,
    ([relativePath, contents]) =>
      fs
        .writeFile(path.join(repositoryRoot, relativePath), contents)
        .pipe(
          Effect.mapError(
            (cause) =>
              new IconExportFileSystemError({ operation: "write-file", path: relativePath, cause }),
          ),
        ),
    { discard: true },
  );
  yield* Console.log(`Updated ${generated.size} generated icon assets.`);
});

export const exportBrandIconsCommand = Command.make(
  "export-brand-icons",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Verify generated icon assets without modifying files."),
      Flag.withDefault(false),
    ),
  },
  ({ check }) => exportBrandIcons(check),
).pipe(
  Command.withDescription(
    "Render the development, nightly and production icons from the master cloche SVGs.",
  ),
);

if (import.meta.main) {
  Command.run(exportBrandIconsCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
