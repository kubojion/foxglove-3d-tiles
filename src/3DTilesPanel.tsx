import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PanelExtensionContext, Topic, MessageEvent } from "@foxglove/extension";
import * as THREE from "three";

import {
  Config,
  NavSatFixMessage,
  JointStateMessage,
  TFMessage,
  RobotPosition,
  LayerConfig,
} from "./types";
import { DEFAULT_CONFIG } from "./constants";
import { TFSystem } from "./systems/TFSystem";
import { GlobeTransformer } from "./systems/GlobeTransformer";
import type { MapLayer } from "./layers";
import { createMapLayer } from "./layers";
import { ThreeDSceneManager } from "./ThreeDSceneManager";
import { SettingsPanel } from "./components/SettingsPanel";

// ==================== MAIN PANEL ====================

function ThreeDTilesPanel({
  context,
  topics,
  currentFrame,
}: {
  context: PanelExtensionContext;
  topics: readonly Topic[];
  currentFrame?: readonly MessageEvent[];
}) {
  const [config, setConfig] = useState<Config>(() => {
    const saved = context.initialState as Partial<Config> | undefined;
    return { ...DEFAULT_CONFIG, ...saved };
  });

  const [robotPosition, setRobotPosition] = useState<RobotPosition | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<string>("");
  const sceneManagerRef = useRef<ThreeDSceneManager | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastUpdateTime = useRef<number>(0);
  const tilesInitializedForKey = useRef<string>("");

  // URDF state
  const urdfLoadedRef = useRef(false);
  const urdfXmlRef = useRef<string>("");

  // Camera state
  const firstGPSRef = useRef(false);

  // TF orientation (from /tf topic)
  const robotOrientationRef = useRef<{ x: number; y: number; z: number; w: number } | null>(null);

  // TF system for full transform tree
  const tfSystemRef = useRef<TFSystem>(new TFSystem());

  // Globe transformer for layers
  const transformerRef = useRef<GlobeTransformer>(new GlobeTransformer(tfSystemRef.current));

  // Map layer instances
  const layersRef = useRef<Map<string, MapLayer>>(new Map());

  // Available TF frames for settings dropdowns
  const [availableFrames, setAvailableFrames] = useState<string[]>([]);
  const lastFrameCountRef = useRef(0);

  // Local files callback (for URDF meshes)
  const [localFolderName, setLocalFolderName] = useState("");
  const handleFilesLoaded = useCallback((fileMap: Map<string, string>, folderName: string) => {
    const manager = sceneManagerRef.current;
    if (manager) {
      manager.setLocalFiles(fileMap);
    }
    setLocalFolderName(folderName);
  }, []);

  // Custom tiles callback
  const [customTileFolderName, setCustomTileFolderName] = useState("");
  const handleCustomTileFiles = useCallback((files: FileList) => {
    const manager = sceneManagerRef.current;
    if (!manager) return;
    // Extract folder name
    let folder = "";
    if (files.length > 0) {
      const path = (files[0] as any).webkitRelativePath || files[0]!.name;
      if (path.includes("/")) folder = path.split("/")[0]!;
    }
    setCustomTileFolderName(folder || "custom");
    manager.loadLocalTileset(files);
  }, []);

  const updateConfig = useCallback(
    (newConfig: Partial<Config>) => {
      const updated = { ...config, ...newConfig };
      setConfig(updated);
      context.saveState(updated);
    },
    [config, context],
  );

  // Sync layer instances with config.layers
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;

    const currentLayers = layersRef.current;
    const configLayerIds = new Set(config.layers.map((l) => l.id));

    // Remove deleted layers
    for (const [id, layer] of currentLayers) {
      if (!configLayerIds.has(id)) {
        manager.scene.remove(layer.getGroup());
        layer.dispose();
        currentLayers.delete(id);
      }
    }

    // Add new layers + update existing
    for (const lc of config.layers) {
      let layer = currentLayers.get(lc.id);
      if (!layer) {
        layer = createMapLayer(lc);
        currentLayers.set(lc.id, layer);
        manager.scene.add(layer.getGroup());
        console.log(`[Layers] Created ${lc.type} layer: ${lc.id}`);
      }
      layer.topic = lc.topic;
      layer.setVisible(lc.visible);
      layer.setColor(lc.color);
      layer.setOpacity(lc.opacity);
      // Update buffer on NavSat layers
      if ((layer as any).setBuffer) {
        (layer as any).setBuffer(lc.buffer || 1000);
      }
    }
  }, [config.layers]);

  // Manage topic subscriptions (includes layer topics)
  useEffect(() => {
    const layerTopics = config.layers
      .filter((l) => l.topic)
      .map((l) => l.topic);
    const allTopics = [
      config.gpsTopic,
      config.urdfTopic,
      config.jointStateTopic,
      "/tf",
      "/tf_static",
      ...layerTopics,
    ].filter(Boolean);
    const unique = [...new Set(allTopics)];
    context.subscribe(unique.map((topic) => ({ topic })));
  }, [context, config.gpsTopic, config.urdfTopic, config.jointStateTopic, config.layers]);

  // Callback ref: initializes Three.js scene when container mounts
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (sceneManagerRef.current) {
      sceneManagerRef.current.dispose();
      sceneManagerRef.current = null;
    }

    containerRef.current = node;
    if (!node) return;

    try {
      const manager = new ThreeDSceneManager(node);
      sceneManagerRef.current = manager;
      manager.startRenderLoop();
      setStatus("Scene ready");
      console.log("[3DTiles] Three.js scene initialized");

      const observer = new ResizeObserver(() => manager.resize());
      observer.observe(node);
      resizeObserverRef.current = observer;
    } catch (err) {
      console.error("[3DTiles] Failed to init scene:", err);
      setStatus(
        "Error: " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
      if (sceneManagerRef.current) {
        sceneManagerRef.current.dispose();
        sceneManagerRef.current = null;
      }
    };
  }, []);

  // Init / update tiles when API key or map source changes
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;

    if (config.mapSource === "google") {
      if (!config.googleApiKey) {
        setStatus("Enter Google Maps API Key in settings");
        return;
      }
      if (tilesInitializedForKey.current === config.googleApiKey) return;
      tilesInitializedForKey.current = config.googleApiKey;

      setStatus("Loading Google 3D Tiles...");
      console.log("[3DTiles] Initializing Google tiles...");

      try {
        manager.initTiles(config.googleApiKey);

        if (manager.tilesRenderer) {
          manager.tilesRenderer.addEventListener("load-root-tileset", () => {
            console.log("[3DTiles] Root tileset loaded!");
            setStatus("3D Tiles loaded!");
            setTimeout(() => setStatus(""), 3000);
          });
          manager.tilesRenderer.addEventListener(
            "load-error",
            (event: { url: string | URL; error: Error }) => {
              console.error("[3DTiles] Tile error:", event.error, event.url);
              setStatus("Tile error: " + event.error.message);
            },
          );
        }
      } catch (err) {
        console.error("[3DTiles] initTiles error:", err);
        setStatus("Error: " + (err instanceof Error ? err.message : String(err)));
        tilesInitializedForKey.current = "";
      }
    }
    // Custom tiles are loaded via the file input callback, not here.
    // But we need to apply georeference when settings change.
  }, [config.googleApiKey, config.mapSource]);

  // Apply georeference transform when custom tile settings change
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;
    manager.updateMapTransform(
      config.mapSource,
      config.customLat,
      config.customLon,
      config.customAlt,
      config.customHeading,
      config.customScale,
    );
  }, [config.mapSource, config.customLat, config.customLon, config.customAlt, config.customHeading, config.customScale]);

  // Process incoming messages (GPS, URDF, JointState)
  useEffect(() => {
    if (!currentFrame || currentFrame.length === 0) return;

    const now = Date.now();
    const manager = sceneManagerRef.current;

    for (const messageEvent of currentFrame) {
      // GPS
      if (messageEvent.topic === config.gpsTopic) {
        // if (now - lastUpdateTime.current < 100) continue;
        // lastUpdateTime.current = now;

        const msg = messageEvent.message as NavSatFixMessage;
        if (msg.latitude && msg.longitude) {
          setRobotPosition({
            latitude: msg.latitude,
            longitude: msg.longitude,
            altitude: msg.altitude || 0,
          });
        }
      }

      // URDF robot_description (std_msgs/String)
      if (messageEvent.topic === config.urdfTopic && config.showUrdf) {
        const msg = messageEvent.message as { data?: string };
        const xml = msg.data || (typeof messageEvent.message === "string" ? messageEvent.message : "");
        if (xml && xml !== urdfXmlRef.current && manager) {
          urdfXmlRef.current = xml;
          console.log("[URDF] Received robot_description, loading...");
          setStatus("Loading URDF...");
          manager.loadUrdf(xml, config.meshServerUrl);
          urdfLoadedRef.current = true;
          setStatus("URDF loaded");
          setTimeout(() => setStatus(""), 2000);
        }
      }

      // Joint states
      if (messageEvent.topic === config.jointStateTopic && manager) {
        const msg = messageEvent.message as JointStateMessage;
        if (msg.name && msg.position) {
          manager.updateJointValues(msg.name, msg.position);
        }
      }

      // TF transforms — extract orientation for base_link + feed TFSystem
      if (messageEvent.topic === "/tf" || messageEvent.topic === "/tf_static") {
        const msg = messageEvent.message as TFMessage;
        const baseFrame = config.framePrefix + "base_link";
        if (msg.transforms) {
          // Feed all transforms to the TF system
          tfSystemRef.current.updateTransforms(msg.transforms);

          // Update available frames list for settings dropdowns
          const frameCount = tfSystemRef.current.getFrameIds().length;
          if (frameCount !== lastFrameCountRef.current) {
            lastFrameCountRef.current = frameCount;
            setAvailableFrames(tfSystemRef.current.getFrameIds().sort());
          }

          // Extract base_link orientation for URDF positioning
          for (const tf of msg.transforms) {
            if (tf.child_frame_id === baseFrame) {
              robotOrientationRef.current = tf.transform.rotation;
            }
          }
        }
      }
    }

    // Feed messages to layers
    for (const layer of layersRef.current.values()) {
      layer.processMessages(currentFrame);
    }
  }, [currentFrame, config.gpsTopic, config.urdfTopic, config.jointStateTopic, config.showUrdf, config.meshServerUrl, config.framePrefix]);

  // Track previous robot ECEF position for follow-mode camera delta
  const prevRobotEcefRef = useRef<THREE.Vector3 | null>(null);

  // Update robot marker, URDF position, and camera
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager || !robotPosition) return;

    // ---- Step 1: Update transformer (pins anchor on first call) ----
    const fullFixedFrame = config.framePrefix + config.fixedFrame;
    const fullDisplayFrame = config.framePrefix + config.displayFrame;
    const transformer = transformerRef.current;
    transformer.getGroundPosition = (lat, lon) => manager.getGroundPosition(lat, lon);
    transformer.update(
      robotPosition.latitude,
      robotPosition.longitude,
      robotPosition.altitude,
      config.altitudeOffset,
      fullFixedFrame,
      fullDisplayFrame,
      config.framePrefix,
    );

    // ---- Step 2: Position everything through the transformer ----
    // This ensures URDF, TF frames, markers, and layers all share
    // the same stable ENU origin → no jitter, no drift.

    // Robot marker
    if (config.showRobotMarker) {
      manager.updateRobotMarkerViaTransformer(transformer);
    } else {
      manager.removeRobotMarker();
    }

    // Trail
    if (config.showTrail) {
      manager.updateTrailViaTransformer(transformer);
    } else {
      manager.clearTrail();
    }

    // URDF positioning via transformer (same coordinate system as TF and layers)
    if (config.showUrdf && manager.urdfLoaded) {
      manager.positionUrdfViaTransformer(transformer);
      manager.setUrdfVisible(true);
    } else {
      manager.setUrdfVisible(false);
    }

    // TF frame visualization (uses transformer → shared ENU origin)
    // No fixed-frame guard: TF frames should always be visible and move with
    // the robot regardless of which fixed frame is selected.  The transformer
    // uses world transforms, so it works for any frame in the TF tree.
    if (config.showTf) {
      manager.updateTfVisualization(transformer, config.tfSize);
      manager.setTfVisible(true);
    } else {
      manager.setTfVisible(false);
    }

    // Update layer visualizations (transformer uses pinned anchor → stable paths)
    for (const layer of layersRef.current.values()) {
      layer.updateVisualization(transformer);
    }

    // Camera follow using transformer-derived ECEF (same coordinate system as robot)
    const robotEcef = transformer.transformToGlobe(new THREE.Vector3(), fullDisplayFrame);
    if (!firstGPSRef.current) {
      firstGPSRef.current = true;
      manager.setInitialView(robotPosition.latitude, robotPosition.longitude);
      if (robotEcef) prevRobotEcefRef.current = robotEcef.clone();
    } else if (config.followMode === "follow" && prevRobotEcefRef.current && robotEcef) {
      manager.followRobotEcef(prevRobotEcefRef.current, robotEcef);
      prevRobotEcefRef.current = robotEcef.clone();
    } else if (robotEcef) {
      prevRobotEcefRef.current = robotEcef.clone();
    }
    // "free" mode: do nothing — user controls camera entirely
  }, [
    robotPosition,
    config.followMode,
    config.showRobotMarker,
    config.showTrail,
    config.showUrdf,
    config.altitudeOffset,
    config.showTf,
    config.tfSize,
    config.fixedFrame,
    config.displayFrame,
    config.framePrefix,
    config.layers,
  ]);

  // URDF opacity
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (manager) manager.setUrdfOpacity(config.urdfOpacity);
  }, [config.urdfOpacity]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Three.js canvas — ALWAYS rendered */}
      <div
        ref={setContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />

      {/* Settings button */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          zIndex: 1000,
          padding: "8px 14px",
          backgroundColor: "rgba(45,45,45,0.8)",
          color: "white",
          border: "1px solid #555",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "14px",
        }}
      >
        ⚙ Settings
      </button>

      {/* Status bar */}
      {status && (
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            padding: "8px 16px",
            backgroundColor: "rgba(0,0,0,0.8)",
            color: "white",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "monospace",
          }}
        >
          {status}
        </div>
      )}

      {/* Robot position HUD */}
      {robotPosition && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            left: "10px",
            zIndex: 1000,
            padding: "10px",
            backgroundColor: "rgba(0,0,0,0.7)",
            color: "white",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "monospace",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "4px" }}>Robot Position</div>
          <div>Lat: {robotPosition.latitude.toFixed(7)}</div>
          <div>Lon: {robotPosition.longitude.toFixed(7)}</div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "350px",
            height: "100%",
            backgroundColor: "#2d2d2d",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.5)",
            zIndex: 1000,
            overflowY: "auto",
          }}
        >
          <button
            onClick={() => setShowSettings(false)}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: "24px",
              cursor: "pointer",
              zIndex: 1001,
            }}
          >
            ✕
          </button>
          <SettingsPanel
            config={config}
            onConfigChange={updateConfig}
            topics={topics}
            onFilesLoaded={handleFilesLoaded}
            localFolderName={localFolderName}
            availableFrames={availableFrames}
            onRecenter={() => transformerRef.current.recenter()}
            onCustomTileFiles={handleCustomTileFiles}
            customTileFolderName={customTileFolderName}
            onSnapToRobot={() => {
              if (robotPosition) {
                updateConfig({
                  customLat: robotPosition.latitude,
                  customLon: robotPosition.longitude,
                  customAlt: robotPosition.altitude,
                });
              }
            }}
            onSnapToFixedFrame={() => {
              const loc = sceneManagerRef.current?.getFixedFrameLocation(transformerRef.current);
              if (loc) {
                updateConfig({ customLat: loc.lat, customLon: loc.lon, customAlt: loc.alt });
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

// ==================== FOXGLOVE ENTRY ====================

export function initThreeDTilesPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);

  let topics: readonly Topic[] = [];
  let currentFrame: readonly MessageEvent[] | undefined;

  context.watch("topics");
  context.watch("currentFrame");

  // Track subscribed topics to avoid re-subscribing
  let subscribedTopics: string[] = [];

  context.onRender = (renderState, done) => {
    if (renderState.topics) {
      topics = renderState.topics;
    }
    if (renderState.currentFrame) {
      currentFrame = renderState.currentFrame;
    }

    // Initial subscription (layers managed by component useEffect)
    if (subscribedTopics.length === 0) {
      const savedConfig = (context.initialState as Partial<Config>) || {};
      const gpsTopic = savedConfig.gpsTopic || DEFAULT_CONFIG.gpsTopic;
      const urdfTopic = savedConfig.urdfTopic || DEFAULT_CONFIG.urdfTopic;
      const jointStateTopic = savedConfig.jointStateTopic || DEFAULT_CONFIG.jointStateTopic;
      const savedLayers = (savedConfig.layers || []) as LayerConfig[];
      const layerTopics = savedLayers.map((l) => l.topic).filter(Boolean);

      const neededTopics = [gpsTopic, urdfTopic, jointStateTopic, "/tf", "/tf_static", ...layerTopics].filter(Boolean);
      subscribedTopics = neededTopics;
      context.subscribe(neededTopics.map((topic) => ({ topic })));
    }

    root.render(
      <ThreeDTilesPanel context={context} topics={topics} currentFrame={currentFrame} />,
    );
    done();
  };

  return () => {
    root.unmount();
  };
}
