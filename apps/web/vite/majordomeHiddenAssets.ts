// The device panel is hidden in Majordome, so its 3D phone and tablet models (about 12 MB) are
// left out of the web client. Upstream's imports stay as they are; each resolves to no address.
import type { Plugin } from "vite-plus";

const HIDDEN_ASSET = /\/apps\/web\/src\/components\/device\/models\/[^/]+\.glb\?url$/;

export function majordomeHiddenAssetsPlugin(): Plugin {
  return {
    name: "majordome-hidden-assets",
    enforce: "pre",
    load(id) {
      return HIDDEN_ASSET.test(id) ? 'export default "";' : undefined;
    },
  };
}
