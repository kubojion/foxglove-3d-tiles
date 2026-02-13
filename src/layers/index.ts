import { LayerConfig } from "../types";
import { MapLayer } from "./MapLayer";
import { PathLayer } from "./PathLayer";
import { OdometryLayer } from "./OdometryLayer";
import { NavSatLayer } from "./NavSatLayer";

export type { MapLayer } from "./MapLayer";
export { PathLayer } from "./PathLayer";
export { OdometryLayer } from "./OdometryLayer";
export { NavSatLayer } from "./NavSatLayer";

export function createMapLayer(config: LayerConfig): MapLayer {
  switch (config.type) {
    case "path": return new PathLayer(config);
    case "odometry": return new OdometryLayer(config);
    case "navsat": return new NavSatLayer(config);
    default: return new PathLayer(config);
  }
}
