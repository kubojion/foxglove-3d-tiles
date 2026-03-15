import { LayerConfig } from "../types";
import { MapLayer } from "./MapLayer";
import { PathLayer } from "./PathLayer";
import { OdometryLayer } from "./OdometryLayer";
import { NavSatLayer } from "./NavSatLayer";
import { MarkerLayer } from "./MarkerLayer";
import { OccupancyGridLayer } from "./OccupancyGridLayer";

export type { MapLayer } from "./MapLayer";
export { PathLayer } from "./PathLayer";
export { OdometryLayer } from "./OdometryLayer";
export { NavSatLayer } from "./NavSatLayer";
export { MarkerLayer } from "./MarkerLayer";
export { OccupancyGridLayer } from "./OccupancyGridLayer";

export function createMapLayer(config: LayerConfig): MapLayer {
  switch (config.type) {
    case "path":
      return new PathLayer(config);
    case "odometry":
      return new OdometryLayer(config);
    case "navsat": {
      const layer = new NavSatLayer(config);
      if (config.positionTolerance != null) {
        layer.setPositionTolerance(config.positionTolerance);
      }
      return layer;
    }
    case "marker":
      return new MarkerLayer(config);
    case "costmap":
      return new OccupancyGridLayer(config);
    default:
      return new PathLayer(config);
  }
}
