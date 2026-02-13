// ==================== TYPE DEFINITIONS ====================

export type Config = {
  mapSource: "google" | "custom";
  googleApiKey: string;
  followMode: "free" | "follow";
  gpsTopic: string;
  showRobotMarker: boolean;
  showTrail: boolean;
  // URDF
  showUrdf: boolean;
  urdfTopic: string;
  jointStateTopic: string;
  meshServerUrl: string;
  urdfOpacity: number;
  framePrefix: string;
  altitudeOffset: number;
  // TF Visualization
  showTf: boolean;
  tfSize: number;
  fixedFrame: string;
  displayFrame: string;
  // Dynamic layers
  layers: LayerConfig[];
  // Custom tiles georeference
  customLat: number;
  customLon: number;
  customAlt: number;
  customHeading: number;
  customScale: number;
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

export type LayerType = "path" | "odometry" | "navsat";

export type LayerConfig = {
  id: string;
  type: LayerType;
  topic: string;
  color: string;
  opacity: number;
  visible: boolean;
  buffer: number;
};
