import { ExtensionContext } from "@foxglove/extension";
import { initThreeDTilesPanel } from "./3DTilesPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "foxglove-3d-tiles",
    displayName: "Foxglove 3D Tiles",
    initPanel: initThreeDTilesPanel,
  });
}
