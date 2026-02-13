import { Ellipsoid } from "3d-tiles-renderer";
import { Config } from "./types";

// ==================== CONSTANTS ====================

export const DEFAULT_CONFIG: Config = {
  mapSource: "google",
  googleApiKey: "",
  followMode: "follow",
  gpsTopic: "/gps/fix",
  showRobotMarker: true,
  showTrail: true,
  showUrdf: true,
  urdfTopic: "/robot_description",
  jointStateTopic: "/joint_states",
  meshServerUrl: "http://localhost:9090",
  urdfOpacity: 1.0,
  framePrefix: "",
  altitudeOffset: 0,
  showTf: false,
  tfSize: 1.0,
  fixedFrame: "map",
  displayFrame: "base_link",
  layers: [],
  customLat: 0,
  customLon: 0,
  customAlt: 0,
  customHeading: 0,
  customScale: 1.0,
};

export const WGS84_ELLIPSOID = new Ellipsoid(6378137.0, 6378137.0, 6356752.314245);
export const DEG2RAD = Math.PI / 180;
