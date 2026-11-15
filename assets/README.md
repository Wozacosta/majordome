# Brand icons

The masters are the SVGs in `brand/`; see [docs/brand.md](../docs/brand.md) for the design.

Run `vp run icons:export` from the repository root to regenerate every tracked desktop, iOS, Linux,
Windows and web icon in `dev/`, `nightly/` and `prod/` (and `icon.svg`) from them. The development
web exports are also copied to `apps/web/public` for the browser favicon, web app manifest icons
and splash screen. Run `vp run icons:check` to verify that the generated assets match their sources
without changing files. Do not edit the generated PNG or ICO files directly.

The file names (`black-*`, `blueprint-*`, `t3-black-*`) are inherited from T3 Code and kept so
the desktop, mobile and release scripts that reference them stay close to upstream.

## Icon Composer projects and Android

The `app-icon.icon` Icon Composer projects still hold T3 Code's artwork. They are no longer used
for the desktop or web icons; only the mobile app reads them (`iosIcon` in
`apps/mobile/app.config.ts`, and `vp run icons:export:android`). Redrawing the mobile icons is
separate work.

Android masks the central 72dp of a 108dp adaptive canvas, and the Android 12+ splash screen masks
the central two thirds of a 288dp canvas, so the Android artwork is rendered from the Icon Composer
SVG layers by `vp run icons:export:android`:

- `apps/mobile/assets/android-icon-foreground.png`: the shared transparent wordmark, sized to stay
  inside the safe zone
- `apps/mobile/assets/android-icon-background-dev.png` and `-nightly.png`: full-bleed variant
  artwork. Production uses a solid color.
- `apps/mobile/assets/android-splash-icon-*.png`: the two layers composed into one 288dp image, so
  the splash mask reproduces the launcher icon's framing.

`android-icon-mark.png` remains a flat silhouette for Android's monochrome themed icon.
