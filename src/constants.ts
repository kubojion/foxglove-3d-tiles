import { Ellipsoid } from "3d-tiles-renderer";
import { Config } from "./types";

// ==================== CONSTANTS ====================

export const DEFAULT_CONFIG: Config = {
  mapSource: "google",
  googleApiKey: "",
  followMode: "follow",
  gpsTopic: "",
  showRobotMarker: false,
  showTrail: false,
  trailLength: 500,
  showUrdf: true,
  urdfSourceMode: "topic",
  urdfTopic: "",
  jointStateTopic: "/joint_states",
  meshFolderPath: "",
  urdfOpacity: 1.0,
  framePrefix: "",
  altitudeOffset: 0,
  showTf: false,
  showTfLabels: false,
  tfSize: 1.0,
  fixedFrame: "map",
  displayFrame: "base_link",
  showGrid: false,
  gridSize: 200,
  gridSpacing: 5,
  gridHeightOffset: 0,
  gridLineWidth: 1,
  waypointTopic: "/clicked_point",
  layers: [],
  customLat: 0,
  customLon: 0,
  customAlt: 0,
  customHeading: 0,
  customScale: 1.0,
  useNativeGeoref: true,
  osmZoom: 19,
  osmRobotHeight: 0.5,
  tileQuality: 12,
};

export const WGS84_ELLIPSOID = new Ellipsoid(6378137.0, 6378137.0, 6356752.314245);
export const DEG2RAD = Math.PI / 180;
