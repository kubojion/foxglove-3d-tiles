// ==================== TYPE DEFINITIONS ====================

export type Config = {
  mapSource: "google" | "custom" | "osm";
  googleApiKey: string;
  followMode: "free" | "follow";
  gpsTopic: string;
  showRobotMarker: boolean;
  showTrail: boolean;
  trailLength: number;
  // URDF
  showUrdf: boolean;
  urdfSourceMode: "topic" | "file";
  urdfTopic: string;
  jointStateTopic: string;
  meshFolderPath: string;
  urdfOpacity: number;
  framePrefix: string;
  altitudeOffset: number;
  // TF Visualization
  showTf: boolean;
  showTfLabels: boolean;
  tfSize: number;
  fixedFrame: string;
  displayFrame: string;
  // Grid overlay
  showGrid: boolean;
  gridSize: number;
  gridSpacing: number;
  gridHeightOffset: number;
  gridLineWidth: number;
  // Waypoint publishing
  waypointTopic: string;
  // Dynamic layers
  layers: LayerConfig[];
  // Custom tiles georeference
  customLat: number;
  customLon: number;
  customAlt: number;
  customHeading: number;
  customScale: number;
  useNativeGeoref: boolean;
  // OSM 2D map
  osmZoom: number;
  osmRobotHeight: number;
  // 3D tile quality
  tileQuality: number;
};

export type NavSatFixMessage = {
  latitude: number;
  longitude: number;
  altitude: number;
};

export type JointStateMessage = {
  name: string[];
  position: number[];
  velocity: number[];
  effort: number[];
};

export type TFTransformStamped = {
  header: { frame_id: string };
  child_frame_id: string;
  transform: {
    translation: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  };
};

export type TFMessage = {
  transforms: TFTransformStamped[];
};

export type RobotPosition = {
  latitude: number;
  longitude: number;
  altitude: number;
};

export type LayerType = "path" | "odometry" | "navsat" | "marker" | "costmap";

export type LayerConfig = {
  id: string;
  type: LayerType;
  topic: string;
  color: string;
  opacity: number;
  visible: boolean;
  buffer: number;
  positionTolerance?: number;
  showLine?: boolean;
};

// ==================== MARKER TYPES ====================

export type MarkerMessage = {
  header: { frame_id: string; stamp?: { sec: number; nanosec: number } };
  ns: string;
  id: number;
  type: number;
  action: number; // 0=ADD, 2=DELETE, 3=DELETEALL
  pose: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
  scale: { x: number; y: number; z: number };
  color: { r: number; g: number; b: number; a: number };
  lifetime?: { sec: number; nanosec: number };
  frame_locked?: boolean;
  points?: Array<{ x: number; y: number; z: number }>;
  colors?: Array<{ r: number; g: number; b: number; a: number }>;
  text?: string;
  mesh_resource?: string;
};

export type MarkerArrayMessage = {
  markers: MarkerMessage[];
};

// Marker type constants
export const MARKER_ARROW = 0;
export const MARKER_CUBE = 1;
export const MARKER_SPHERE = 2;
export const MARKER_CYLINDER = 3;
export const MARKER_LINE_STRIP = 4;
export const MARKER_LINE_LIST = 5;
export const MARKER_CUBE_LIST = 6;
export const MARKER_SPHERE_LIST = 7;
export const MARKER_POINTS = 8;
export const MARKER_TEXT = 9;
export const MARKER_TRIANGLE_LIST = 11;

// ==================== WAYPOINT TYPES ====================

export type WaypointData = {
  id: string;
  localPosition: { x: number; y: number; z: number };
  lat: number;
  lon: number;
  alt: number;
  heading: number; // radians, 0 = East (ENU), counter-clockwise positive
};
