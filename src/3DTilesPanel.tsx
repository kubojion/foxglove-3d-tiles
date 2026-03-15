import React, { useState, useRef, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { PanelExtensionContext, Topic, MessageEvent } from "@foxglove/extension";
import * as THREE from "three";

import { GoogleMapsLogo } from "./components/GoogleMapsLogo";
import {
  Config,
  NavSatFixMessage,
  JointStateMessage,
  TFMessage,
  RobotPosition,
  LayerConfig,
  WaypointData,
} from "./types";
import { DEFAULT_CONFIG } from "./constants";
import { TFSystem } from "./systems/TFSystem";
import { GlobeTransformer } from "./systems/GlobeTransformer";
import type { MapLayer } from "./layers";
import { createMapLayer } from "./layers";
import { ThreeDSceneManager } from "./ThreeDSceneManager";
import { SettingsPanel } from "./components/SettingsPanel";
import { WaypointPanel } from "./components/WaypointPanel";
import { LayersPanel } from "./components/LayersPanel";
import { RobotPanel } from "./components/RobotPanel";
import { CenterIcon, RulerIcon, WaypointIcon, LayersIcon, SettingsIcon, RobotIcon } from "./components/Icons";

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
  const tilesInitializedForKey = useRef<string>("");

  // URDF state
  const urdfLoadedRef = useRef(false);
  const urdfXmlRef = useRef<string>("");

  // Camera state
  const firstGPSRef = useRef(false);
  const hasRealGpsRef = useRef(false);

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

  // Version counter to trigger re-render on TF updates (for TF-only mode without GPS)
  const [tfVersion, setTfVersion] = useState(0);

  // Interactive tool state
  const [interactionMode, setInteractionMode] = useState<"none" | "waypoint" | "measure">("none");
  const interactionModeRef = useRef<"none" | "waypoint" | "measure">("none");
  useEffect(() => { interactionModeRef.current = interactionMode; }, [interactionMode]);
  const [measureStatus, setMeasureStatus] = useState<string>("");
  const waypointAdvertisedRef = useRef<{ topic: string; schema: string } | null>(null);

  // Map attribution overlay
  const [attribution, setAttribution] = useState<string>("");

  // Waypoint panel state
  const [showWaypoints, setShowWaypoints] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showRobot, setShowRobot] = useState(false);
  const [waypoints, setWaypoints] = useState<WaypointData[]>([]);
  // Drag state for heading selection
  const waypointDragRef = useRef<{
    startPos: THREE.Vector3;
    startNdc: { x: number; y: number };
    isDragging: boolean;
  } | null>(null);
  // Track whether measurements exist (for Clear button)
  const [hasMeasurements, setHasMeasurements] = useState(false);

  // Shift key override: hold Shift to temporarily enable camera in placement/measure modes
  const shiftHeldRef = useRef(false);

  // Local files callback (for URDF meshes)
  const [localFolderName, setLocalFolderName] = useState("");
  const [lastMeshFolderName, setLastMeshFolderName] = useState(() => {
    const saved = context.initialState as Partial<Config & { _lastMeshFolder?: string }> | undefined;
    return saved?._lastMeshFolder || "";
  });
  const handleFilesLoaded = useCallback((fileMap: Map<string, string>, folderName: string) => {
    const manager = sceneManagerRef.current;
    if (manager) {
      manager.setLocalFiles(fileMap);
    }
    setLocalFolderName(folderName);
    setLastMeshFolderName(folderName);
    setConfig((prev) => {
      const updated = { ...prev, _lastMeshFolder: folderName };
      context.saveState(updated);
      return prev;
    });
  }, [context]);

  // URDF file-based loading
  const [urdfFileName, setUrdfFileName] = useState("");
  const handleUrdfFileLoaded = useCallback((xml: string, fileName: string) => {
    const manager = sceneManagerRef.current;
    if (!manager || !xml) return;
    urdfXmlRef.current = xml;
    setUrdfFileName(fileName);
    console.log(`[URDF] Loaded from file: ${fileName}`);
    manager.loadUrdf(xml);
    urdfLoadedRef.current = true;
  }, []);

  // ---- Canvas mouse handlers for waypoint (click-and-drag) and measurement ----
  // We need refs for config values accessed inside event handlers
  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);
  const waypointsRef = useRef(waypoints);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);

  const publishWaypoint = useCallback((localPoint: THREE.Vector3, heading: number) => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const cfg = configRef.current;
    const topic = cfg.waypointTopic;
    if (!topic) return;

    // Auto-detect mode from topic: /goal_pose → PoseStamped (RViz), else → PointStamped (MapViz)
    const isPoseMode = topic.includes("goal_pose");
    const schemaName = isPoseMode
      ? "geometry_msgs/msg/PoseStamped"
      : "geometry_msgs/msg/PointStamped";

    // Advertise if needed
    if (!waypointAdvertisedRef.current || waypointAdvertisedRef.current.topic !== topic || waypointAdvertisedRef.current.schema !== schemaName) {
      if (waypointAdvertisedRef.current) {
        context.unadvertise?.(waypointAdvertisedRef.current.topic);
      }
      context.advertise?.(topic, schemaName);
      waypointAdvertisedRef.current = { topic, schema: schemaName };
    }

    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const nanosec = (now % 1000) * 1_000_000;

    if (isPoseMode) {
      // RViz 2D Nav Goal style: local coordinates in map frame
      const qz = Math.sin(heading / 2);
      const qw = Math.cos(heading / 2);
      context.publish?.(topic, {
        header: { stamp: { sec, nanosec }, frame_id: "map" },
        pose: {
          position: { x: localPoint.x, y: localPoint.y, z: 0 },
          orientation: { x: 0, y: 0, z: qz, w: qw },
        },
      });
      console.log(`[Waypoint] Published PoseStamped to ${topic}: x=${localPoint.x.toFixed(2)}, y=${localPoint.y.toFixed(2)}, hdg=${(heading * 180 / Math.PI).toFixed(1)}°`);
    } else {
      // MapViz style: GPS coordinates in wgs84 frame (x=lon, y=lat)
      const gps = transformer.localToGps(localPoint);
      context.publish?.(topic, {
        header: { stamp: { sec, nanosec }, frame_id: "wgs84" },
        point: { x: gps.lon, y: gps.lat, z: gps.alt },
      });
      console.log(`[Waypoint] Published PointStamped to ${topic}: lat=${gps.lat.toFixed(7)}, lon=${gps.lon.toFixed(7)}`);
    }
  }, [context]);

  // Toggle GlobeControls enabled state: disabled during placement/measure mode
  // Hold Shift to temporarily re-enable camera movement.
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;
    // Need either GlobeControls or MapControls
    if (!manager.controls && !manager.mapControls) return;

    const updateControls = () => {
      const enabled = interactionMode === "none" || shiftHeldRef.current;
      if (manager.controls) manager.controls.enabled = enabled;
      if (manager.mapControls) manager.mapControls.enabled = enabled;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift" && !shiftHeldRef.current) {
        shiftHeldRef.current = true;
        updateControls();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftHeldRef.current = false;
        updateControls();
      }
    };

    updateControls();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [interactionMode]);

  // Strip Shift modifier from pointer events when controls are temporarily
  // re-enabled via shift hold in measure/waypoint mode. Both GlobeControls and
  // MapControls (inherited from OrbitControls) internally map Shift+LEFT to
  // rotate instead of pan. By stripping shiftKey in the capture phase, the
  // controls see a plain LEFT click and pan as expected.
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;
    const canvas = manager.renderer.domElement;

    const stripShift = (e: PointerEvent) => {
      if (!shiftHeldRef.current) return;
      if (interactionModeRef.current === "none") return;
      if (!e.shiftKey) return; // already clean (our re-dispatched event)

      e.stopPropagation();
      canvas.dispatchEvent(new PointerEvent(e.type, {
        bubbles: true, cancelable: true, composed: e.composed,
        clientX: e.clientX, clientY: e.clientY,
        screenX: e.screenX, screenY: e.screenY,
        button: e.button, buttons: e.buttons,
        pointerId: e.pointerId, pointerType: e.pointerType as any,
        width: e.width, height: e.height, pressure: e.pressure,
        tiltX: e.tiltX, tiltY: e.tiltY, isPrimary: e.isPrimary,
        shiftKey: false, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
      }));
    };

    canvas.addEventListener("pointerdown", stripShift, true);
    canvas.addEventListener("pointermove", stripShift, true);
    canvas.addEventListener("pointerup", stripShift, true);
    return () => {
      canvas.removeEventListener("pointerdown", stripShift, true);
      canvas.removeEventListener("pointermove", stripShift, true);
      canvas.removeEventListener("pointerup", stripShift, true);
    };
  }, []);

  // ---- Pointer handlers for waypoint drag-to-heading & measure clicks ----
  const handlePointerDown = useCallback((e: PointerEvent) => {
    const mode = interactionModeRef.current;
    if (mode === "none" || e.button !== 0) return;
    // Shift held = camera override, don't start placement
    if (shiftHeldRef.current) return;

    const manager = sceneManagerRef.current;
    if (!manager) return;

    const rect = manager.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const planeZ = manager.isOSMMode() ? 0 : configRef.current.gridHeightOffset;
    const localPoint = manager.raycastGridPlane(ndcX, ndcY, planeZ);
    if (!localPoint) return;

    waypointDragRef.current = {
      startPos: localPoint.clone(),
      startNdc: { x: e.clientX, y: e.clientY },
      isDragging: false,
    };
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = waypointDragRef.current;
    if (!drag) return;
    if (interactionModeRef.current !== "waypoint") return;

    const dx = e.clientX - drag.startNdc.x;
    const dy = e.clientY - drag.startNdc.y;
    if (Math.sqrt(dx * dx + dy * dy) < 5 && !drag.isDragging) return;
    drag.isDragging = true;

    const manager = sceneManagerRef.current;
    if (!manager) return;

    const rect = manager.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const planeZ = manager.isOSMMode() ? 0 : configRef.current.gridHeightOffset;
    const currentPoint = manager.raycastGridPlane(ndcX, ndcY, planeZ);
    if (!currentPoint) return;

    const deltaX = currentPoint.x - drag.startPos.x;
    const deltaY = currentPoint.y - drag.startPos.y;
    const heading = Math.atan2(deltaY, deltaX);
    manager.showDragArrow(drag.startPos, heading);
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const drag = waypointDragRef.current;
    if (!drag) return;
    waypointDragRef.current = null;

    const mode = interactionModeRef.current;
    const manager = sceneManagerRef.current;
    if (!manager) return;

    if (mode === "waypoint") {
      manager.removeDragArrow();

      // Calculate heading: from drag if dragged, else auto from previous waypoint
      let heading = Math.PI / 2; // default: North
      if (drag.isDragging) {
        const rect = manager.renderer.domElement.getBoundingClientRect();
        const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const planeZ = manager.isOSMMode() ? 0 : configRef.current.gridHeightOffset;
        const endPoint = manager.raycastGridPlane(ndcX, ndcY, planeZ);
        if (endPoint) {
          const dx = endPoint.x - drag.startPos.x;
          const dy = endPoint.y - drag.startPos.y;
          if (Math.sqrt(dx * dx + dy * dy) > 0.1) {
            heading = Math.atan2(dy, dx);
          }
        }
      } else {
        // Auto heading from previous waypoint direction
        const prevWps = waypointsRef.current;
        if (prevWps.length > 0) {
          const prev = prevWps[prevWps.length - 1]!;
          const dx = drag.startPos.x - prev.localPosition.x;
          const dy = drag.startPos.y - prev.localPosition.y;
          if (Math.sqrt(dx * dx + dy * dy) > 0.1) {
            heading = Math.atan2(dy, dx);
          }
        }
      }

      const transformer = transformerRef.current;
      if (!transformer) return;

      const gps = transformer.localToGps(drag.startPos);
      const index = waypointsRef.current.length;
      manager.addWaypointMarker(drag.startPos, heading, index);

      const newWp: WaypointData = {
        id: Date.now().toString(36),
        localPosition: { x: drag.startPos.x, y: drag.startPos.y, z: drag.startPos.z },
        lat: gps.lat,
        lon: gps.lon,
        alt: gps.alt,
        heading,
      };
      setWaypoints((prev) => [...prev, newWp]);
      publishWaypoint(drag.startPos, heading);
    } else if (mode === "measure") {
      // Only process if not a significant drag (ignore accidental drags)
      const dx = e.clientX - drag.startNdc.x;
      const dy = e.clientY - drag.startNdc.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) return;

      const count = manager.addMeasurePoint(drag.startPos);
      setHasMeasurements(true);
      if (count === 1) {
        setMeasureStatus("Click second point");
      } else if (count === 2) {
        setMeasureStatus("Click to start new measurement");
      }
    }
  }, [publishWaypoint]);

  // Attach pointer handlers (bubble phase — GlobeControls is disabled via controls.enabled)
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;
    const canvas = manager.renderer.domElement;
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp]);

  // Cleanup advertised topic on unmount
  useEffect(() => {
    return () => {
      if (waypointAdvertisedRef.current) {
        context.unadvertise?.(waypointAdvertisedRef.current.topic);
      }
    };
  }, [context]);

  // Waypoint management callbacks
  const handleRemoveWaypoint = useCallback((index: number) => {
    const manager = sceneManagerRef.current;
    setWaypoints((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      // Rebuild markers with correct indices
      if (manager) {
        manager.rebuildWaypointMarkers(
          updated.map((wp) => ({ ...wp.localPosition, heading: wp.heading })),
        );
      }
      return updated;
    });
  }, []);

  const handleClearAllWaypoints = useCallback(() => {
    sceneManagerRef.current?.clearWaypoints();
    setWaypoints([]);
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
    manager.loadLocalTileset(files, config.useNativeGeoref);
  }, [config.useNativeGeoref]);

  const updateConfig = useCallback(
    (newConfig: Partial<Config>) => {
      setConfig((prev) => {
        const updated = { ...prev, ...newConfig };
        context.saveState(updated);
        return updated;
      });
    },
    [context],
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
        manager.localOriginGroup.remove(layer.getGroup());
        layer.dispose();
        currentLayers.delete(id);
      }
    }

    // Add new layers + update existing (all inside localOriginGroup for precision)
    for (const lc of config.layers) {
      let layer = currentLayers.get(lc.id);
      if (!layer) {
        layer = createMapLayer(lc);
        currentLayers.set(lc.id, layer);
        manager.localOriginGroup.add(layer.getGroup());
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
      // Update NavSat-specific position tolerance if supported
      if ((layer as any).setPositionTolerance) {
        (layer as any).setPositionTolerance(lc.positionTolerance ?? 0);
      }
      // Update NavSat-specific show line toggle
      if ((layer as any).setShowLine) {
        (layer as any).setShowLine(lc.showLine !== false);
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
      config.urdfSourceMode === "topic" ? config.urdfTopic : "",
      config.jointStateTopic,
      "/tf",
      "/tf_static",
      ...layerTopics,
    ].filter(Boolean);
    const unique = [...new Set(allTopics)];
    context.subscribe(unique.map((topic) => ({ topic })));
  }, [context, config.gpsTopic, config.urdfTopic, config.urdfSourceMode, config.jointStateTopic, config.layers]);

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
      // Dispose all layers
      for (const layer of layersRef.current.values()) layer.dispose();
      layersRef.current.clear();

      resizeObserverRef.current?.disconnect();
      if (sceneManagerRef.current) {
        sceneManagerRef.current.dispose();
        sceneManagerRef.current = null;
      }
    };
  }, []);

  // Update map attribution overlay periodically
  useEffect(() => {
    if (config.mapSource === "osm") {
      setAttribution("© OpenStreetMap contributors");
      return;
    }
    if (config.mapSource !== "google") {
      setAttribution("");
      return;
    }
    // Poll Google tile data attributions every 2 seconds
    const interval = setInterval(() => {
      const manager = sceneManagerRef.current;
      if (!manager) return;
      const attrs = manager.getGoogleAttributions();
      setAttribution(attrs.length > 0 ? attrs.join("; ") : "");
    }, 2000);
    setAttribution("");
    return () => clearInterval(interval);
  }, [config.mapSource]);

  // Init / update tiles when API key or map source changes
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;

    // Reset camera init flag when switching map modes
    firstGPSRef.current = false;

    if (config.mapSource === "osm") {
      // Clean up 3D tiles if switching to OSM
      manager.disposeTiles();
      tilesInitializedForKey.current = "";
      manager.initOSM(config.osmZoom);
      setStatus("OSM 2D map — waiting for GPS fix...");
      return;
    }

    // Switching away from OSM — clean up
    if (manager.isOSMMode()) {
      manager.disposeOSM();
    }

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
  }, [config.googleApiKey, config.mapSource, config.osmZoom]);

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
  }, [config.mapSource, config.customLat, config.customLon, config.customAlt, config.customHeading, config.customScale, config.useNativeGeoref]);

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
      if (config.urdfSourceMode === "topic" && messageEvent.topic === config.urdfTopic && config.showUrdf) {
        const msg = messageEvent.message as { data?: string };
        const xml = msg.data || (typeof messageEvent.message === "string" ? messageEvent.message : "");
        if (xml && xml !== urdfXmlRef.current && manager) {
          urdfXmlRef.current = xml;
          console.log("[URDF] Received robot_description, loading...");
          setStatus("Loading URDF...");
          manager.loadUrdf(xml);
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

          // Trigger positioning update even without GPS (TF-only mode)
          setTfVersion((v) => v + 1);
        }
      }
    }

    // Feed messages to layers
    for (const layer of layersRef.current.values()) {
      layer.processMessages(currentFrame);
    }
  }, [currentFrame, config.gpsTopic, config.urdfTopic, config.urdfSourceMode, config.jointStateTopic, config.showUrdf, config.framePrefix]);

  // Track previous robot local position for follow-mode camera delta
  const prevRobotLocalRef = useRef<THREE.Vector3 | null>(null);

  // Update robot marker, URDF position, and camera
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;

    // Use real GPS or fallback (0,0,0) for TF-only mode.
    // If first real GPS arrives after TF-only, re-pin the anchor.
    const pos = robotPosition || { latitude: 0, longitude: 0, altitude: 0 };
    const hasGps = robotPosition != null;

    if (hasGps && !hasRealGpsRef.current) {
      hasRealGpsRef.current = true;
      // If we previously used the dummy anchor, recenter to real GPS
      const transformer = transformerRef.current;
      if (transformer.getAnchor().lat === 0 && transformer.getAnchor().lon === 0) {
        transformer.recenter();
      }
    }

    // ---- Step 1: Update transformer (pins anchor on first call) ----
    const fullFixedFrame = config.framePrefix + config.fixedFrame;
    const fullDisplayFrame = config.framePrefix + config.displayFrame;
    const transformer = transformerRef.current;
    transformer.getGroundPosition = (lat, lon) => manager.getGroundPosition(lat, lon);
    // In OSM mode, ignore altitude offset (it's a 3D-only concept)
    const effectiveAltOffset = manager.isOSMMode() ? 0 : config.altitudeOffset;
    transformer.update(
      pos.latitude,
      pos.longitude,
      pos.altitude,
      effectiveAltOffset,
      fullFixedFrame,
      fullDisplayFrame,
      config.framePrefix,
    );

    // ---- Step 2: Position localOriginGroup ----
    if (manager.isOSMMode()) {
      // OSM mode: localOriginGroup stays at scene origin
      manager.updateLocalOriginForOSM();
      // Feed anchor to OSM tile system
      if (hasGps && manager.osmTileSystem) {
        manager.osmTileSystem.setAnchor(pos.latitude, pos.longitude);
      }
    } else {
      // 3D mode: position at anchor ECEF on the globe
      manager.updateLocalOrigin(transformer);
    }

    // ---- Step 3: Position everything in local coords ----

    if (config.showRobotMarker) {
      manager.updateRobotMarkerViaTransformer(transformer);
    } else {
      manager.removeRobotMarker();
    }

    if (config.showTrail) {
      manager.updateTrailViaTransformer(transformer, config.trailLength);
    } else {
      manager.clearTrail();
    }

    if (config.showUrdf && manager.urdfLoaded) {
      manager.positionUrdfViaTransformer(transformer);
      manager.setUrdfVisible(true);
    } else {
      manager.setUrdfVisible(false);
    }

    // In OSM mode, lift URDF/marker/trail by osmRobotHeight so they float above the map
    if (manager.isOSMMode()) {
      const rh = config.osmRobotHeight;
      if (manager.urdfGroup) manager.urdfGroup.position.z += rh;
      if (manager.robotMarker) manager.robotMarker.position.z += rh;
      if (manager.trailLine) manager.trailLine.position.z = rh;
    }

    if (config.showTf) {
      manager.updateTfVisualization(transformer, config.tfSize, config.showTfLabels);
      manager.setTfVisible(true);
      // Lift TF in OSM mode, reset in 3D mode
      manager.offsetTfGroup(manager.isOSMMode() ? config.osmRobotHeight : 0);
    } else {
      manager.setTfVisible(false);
    }

    for (const layer of layersRef.current.values()) {
      layer.updateVisualization(transformer);
    }

    // Grid overlay — in OSM mode, grid at Z=0.01 (just above tiles at Z=0)
    manager.updateGrid(
      config.showGrid,
      config.gridSize,
      config.gridSpacing,
      manager.isOSMMode() ? 0.01 : config.gridHeightOffset,
      config.gridLineWidth,
    );

    // Camera follow using local coords (converted to ECEF delta by scene manager)
    const robotLocal = transformer.transformToLocal(new THREE.Vector3(), fullDisplayFrame);

    if (manager.isOSMMode()) {
      // OSM 2D mode: update tiles and camera
      manager.updateOSM(robotLocal, config.osmZoom);

      if (!firstGPSRef.current && hasGps) {
        firstGPSRef.current = true;
        if (robotLocal) {
          manager.centerOSMCamera(robotLocal.x, robotLocal.y);
        }
        setStatus("OSM 2D map loaded");
        setTimeout(() => setStatus(""), 3000);
      } else if (config.followMode === "follow" && robotLocal && manager.mapControls) {
        // Shift camera + target by the robot's movement delta
        const prev = prevRobotLocalRef.current;
        if (prev) {
          const dx = robotLocal.x - prev.x;
          const dy = robotLocal.y - prev.y;
          manager.mapControls.target.x += dx;
          manager.mapControls.target.y += dy;
          manager.camera.position.x += dx;
          manager.camera.position.y += dy;
        }
      }
      if (robotLocal) prevRobotLocalRef.current = robotLocal.clone();
    } else {
      // 3D globe mode
      if (!firstGPSRef.current && hasGps) {
        firstGPSRef.current = true;
        manager.setInitialView(pos.latitude, pos.longitude, pos.altitude);
        if (robotLocal) prevRobotLocalRef.current = robotLocal.clone();
      } else if (config.followMode === "follow" && prevRobotLocalRef.current && robotLocal) {
        manager.followRobotLocal(prevRobotLocalRef.current, robotLocal);
        prevRobotLocalRef.current = robotLocal.clone();
      } else if (robotLocal) {
        prevRobotLocalRef.current = robotLocal.clone();
      }
    }
  }, [
    robotPosition,
    tfVersion,
    config.followMode,
    config.showRobotMarker,
    config.showTrail,
    config.trailLength,
    config.showUrdf,
    config.altitudeOffset,
    config.showTf,
    config.showTfLabels,
    config.tfSize,
    config.fixedFrame,
    config.displayFrame,
    config.framePrefix,
    config.layers,
    config.showGrid,
    config.gridSize,
    config.gridSpacing,
    config.gridHeightOffset,
    config.gridLineWidth,
    config.osmZoom,
    config.osmRobotHeight,
    config.mapSource,
  ]);

  // URDF opacity
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (manager) manager.setUrdfOpacity(config.urdfOpacity);
  }, [config.urdfOpacity]);

  // 3D tile quality (errorTarget)
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (manager) manager.setTileQuality(config.tileQuality);
  }, [config.tileQuality]);

  // Clear URDF from scene when source mode changes or topic is deselected
  useEffect(() => {
    const manager = sceneManagerRef.current;
    if (!manager) return;
    // When switching to file mode, clear the topic-loaded URDF
    // When switching to topic mode, clear the file-loaded URDF
    // When topic is cleared, remove the URDF
    if (config.urdfSourceMode === "file") {
      // Only clear if currently loaded from topic
      if (urdfXmlRef.current && !urdfLoadedRef.current) return;
    }
    if (config.urdfSourceMode === "topic" && !config.urdfTopic) {
      manager.removeUrdf();
      urdfXmlRef.current = "";
      urdfLoadedRef.current = false;
    }
  }, [config.urdfSourceMode, config.urdfTopic]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Purple accent color for all inputs */}
      <style>{`
        input[type="range"] { accent-color: #6f3be8; }
        input[type="checkbox"] { accent-color: #6f3be8; }
      `}</style>

      {/* Three.js canvas — ALWAYS rendered */}
      <div
        ref={setContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />

      {/* Toolbar — horizontal row at top-right */}
      <div
        style={{
          position: "absolute",
          top: "10px",
          right: ((showSettings ? 350 : 0) + (showRobot ? 300 : 0) + (showLayers ? 300 : 0) + (showWaypoints ? 300 : 0) + 10) + "px",
          zIndex: 1000,
          display: "flex",
          gap: "4px",
          transition: "right 0.15s ease",
        }}
      >
        {/* Center */}
        <button
          onClick={() => {
            const manager = sceneManagerRef.current;
            if (!manager) return;
            if (manager.isOSMMode()) {
              // OSM 2D: center on robot using local coords
              const transformer = transformerRef.current;
              const fullDisplayFrame = config.framePrefix + config.displayFrame;
              const robotLocal = transformer.transformToLocal(new THREE.Vector3(), fullDisplayFrame);
              if (robotLocal) manager.centerOSMCamera(robotLocal.x, robotLocal.y);
            } else {
              const pos = robotPosition;
              if (pos) manager.resetCameraToRobot(pos.latitude, pos.longitude, pos.altitude);
            }
          }}
          title="Center camera on robot"
          style={{
            padding: "6px 10px",
            backgroundColor: "rgba(45,45,45,0.85)",
            color: "white",
            border: "1px solid #555",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          <CenterIcon /> Center
        </button>

        {/* Measure */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <button
            onClick={() => {
              const newMode = interactionMode === "measure" ? "none" : "measure";
              setInteractionMode(newMode);
              setMeasureStatus(newMode === "measure" ? "Click first point" : "");
            }}
            title="Measure distance between two points on grid"
            style={{
              padding: "6px 10px",
              backgroundColor: "rgba(45,45,45,0.85)",
              color: "white",
              border: interactionMode === "measure" ? "2px solid #6f3be8" : "1px solid #555",
              borderRadius: "4px 4px" + (hasMeasurements && interactionMode === "measure" ? " 0 0" : " 4px 4px"),
              cursor: "pointer",
              fontSize: "13px",
              whiteSpace: "nowrap",
            }}
          >
            <RulerIcon /> Measure
          </button>
          {hasMeasurements && interactionMode === "measure" && (
            <button
              onClick={() => {
                sceneManagerRef.current?.clearMeasurement();
                setHasMeasurements(false);
                setMeasureStatus("Click first point");
              }}
              title="Clear all measurements"
              style={{
                padding: "3px 8px",
                backgroundColor: "rgba(90,32,32,0.9)",
                color: "#ff8888",
                border: "1px solid #883333",
                borderRadius: "0 0 4px 4px",
                cursor: "pointer",
                fontSize: "10px",
                whiteSpace: "nowrap",
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Waypoint — opens/closes panel only */}
        <button
          onClick={() => setShowWaypoints(!showWaypoints)}
          title="Open waypoint panel"
          style={{
            padding: "6px 10px",
            backgroundColor: "rgba(45,45,45,0.85)",
            color: "white",
            border: showWaypoints ? "2px solid #6f3be8" : "1px solid #555",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          <WaypointIcon /> Waypoint
        </button>

        {/* Layers */}
        <button
          onClick={() => setShowLayers(!showLayers)}
          title="Open visualization layers panel"
          style={{
            padding: "6px 10px",
            backgroundColor: "rgba(45,45,45,0.85)",
            color: "white",
            border: showLayers ? "2px solid #6f3be8" : "1px solid #555",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          <LayersIcon /> Layers
        </button>

        {/* Robot */}
        <button
          onClick={() => setShowRobot(!showRobot)}
          title="Open robot panel (URDF + TF)"
          style={{
            padding: "6px 10px",
            backgroundColor: "rgba(45,45,45,0.85)",
            color: "white",
            border: showRobot ? "2px solid #6f3be8" : "1px solid #555",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          <RobotIcon /> Robot
        </button>

        {/* Settings */}
        <button
          onClick={() => {
            setShowSettings(!showSettings);
          }}
          style={{
            padding: "6px 10px",
            backgroundColor: "rgba(45,45,45,0.85)",
            color: "white",
            border: showSettings ? "2px solid #6f3be8" : "1px solid #555",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
            whiteSpace: "nowrap",
          }}
        >
          <SettingsIcon /> Settings
        </button>
      </div>

      {/* Interaction mode status badge */}
      {(measureStatus || interactionMode === "waypoint") && (
        <div
          style={{
            position: "absolute",
            top: "48px",
            right: ((showSettings ? 350 : 0) + (showRobot ? 300 : 0) + (showLayers ? 300 : 0) + (showWaypoints ? 300 : 0) + 10) + "px",
            zIndex: 1000,
            padding: "4px 10px",
            backgroundColor: "rgba(0,0,0,0.8)",
            color: "#ccc",
            borderRadius: "4px",
            fontSize: "11px",
            fontFamily: "monospace",
            transition: "right 0.15s ease",
          }}
        >
          {interactionMode === "waypoint"
            ? "Click grid to place waypoint · Drag to set heading"
            : measureStatus}
        </div>
      )}

      {/* Mode indicator bar — centered relative to the 3D viewport (not full panel) */}
      {interactionMode !== "none" && (() => {
        const panelsWidth = (showSettings ? 350 : 0) + (showLayers ? 300 : 0) + (showWaypoints ? 300 : 0) + (showRobot ? 300 : 0);
        return (
          <div
            style={{
              position: "absolute",
              bottom: "10px",
              left: `calc((100% - ${panelsWidth}px) / 2)`,
              transform: "translateX(-50%)",
              zIndex: 1001,
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 18px",
              backgroundColor: "rgba(111,59,232,0.9)",
              color: "#fff",
              borderRadius: "6px",
              fontSize: "12px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
              whiteSpace: "nowrap",
              transition: "left 0.15s ease",
            }}
          >
            <span style={{ fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" }}>
              {interactionMode === "measure"
                ? <><RulerIcon size={14} /> Measure Mode</>
                : <><WaypointIcon size={14} /> Waypoint Mode</>}
            </span>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px" }}>
              Camera locked · Hold <kbd style={{
                padding: "1px 5px",
                backgroundColor: "rgba(255,255,255,0.2)",
                borderRadius: "3px",
                border: "1px solid rgba(255,255,255,0.3)",
                fontSize: "11px",
                fontFamily: "inherit",
              }}>Shift</kbd> to move camera
            </span>
          </div>
        );
      })()}

      {/* Google Maps logo — required by Google Maps Platform Tile API policy */}
      {config.mapSource === "google" && (
        <div
          style={{
            position: "absolute",
            bottom: "5px",
            left: "10px",
            zIndex: 999,
            pointerEvents: "none",
          }}
        >
          <GoogleMapsLogo />
        </div>
      )}

      {/* Map data attribution — required by Google Maps Platform and OpenStreetMap */}
      {attribution && (
        <div
          style={{
            position: "absolute",
            bottom: "2px",
            right: ((showSettings ? 350 : 0) + (showRobot ? 300 : 0) + (showLayers ? 300 : 0) + (showWaypoints ? 300 : 0) + 4) + "px",
            zIndex: 999,
            padding: "2px 6px",
            backgroundColor: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.8)",
            borderRadius: "3px",
            fontSize: "10px",
            fontFamily: "sans-serif",
            pointerEvents: "none",
            maxWidth: "60%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            transition: "right 0.15s ease",
          }}
        >
          {attribution}
        </div>
      )}

      {/* Status bar */}
      {status && (
        <div
          style={{
            position: "absolute",
            bottom: interactionMode !== "none" ? "50px" : "10px",
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

      {/* Waypoint panel — sits to the left of layers/settings */}
      {showWaypoints && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: ((showSettings ? 350 : 0) + (showRobot ? 300 : 0) + (showLayers ? 300 : 0)) + "px",
            width: "300px",
            height: "100%",
            backgroundColor: "#2d2d2d",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.5)",
            zIndex: 1000,
            overflowY: "auto",
          }}
        >
          <button
            onClick={() => setShowWaypoints(false)}
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
          <WaypointPanel
            config={config}
            onConfigChange={updateConfig}
            topics={topics}
            waypoints={waypoints}
            onRemoveWaypoint={handleRemoveWaypoint}
            onClearAll={handleClearAllWaypoints}
            interactionMode={interactionMode}
            onModeChange={(mode) => {
              setInteractionMode(mode);
              if (mode !== "measure") setMeasureStatus("");
              if (mode === "measure") sceneManagerRef.current?.clearMeasurement();
            }}
          />
        </div>
      )}

      {/* Layers panel — sits between waypoints and robot */}
      {showLayers && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: ((showSettings ? 350 : 0) + (showRobot ? 300 : 0)) + "px",
            width: "300px",
            height: "100%",
            backgroundColor: "#2d2d2d",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.5)",
            zIndex: 1000,
            overflowY: "auto",
          }}
        >
          <button
            onClick={() => setShowLayers(false)}
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
          <LayersPanel
            config={config}
            onConfigChange={updateConfig}
            topics={topics}
          />
        </div>
      )}

      {/* Robot panel — between layers and settings */}
      {showRobot && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: (showSettings ? 350 : 0) + "px",
            width: "300px",
            height: "100%",
            backgroundColor: "#2d2d2d",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.5)",
            zIndex: 1000,
            overflowY: "auto",
          }}
        >
          <button
            onClick={() => setShowRobot(false)}
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
          <RobotPanel
            config={config}
            onConfigChange={updateConfig}
            topics={topics}
            onFilesLoaded={handleFilesLoaded}
            localFolderName={localFolderName}
            availableFrames={availableFrames}
            onUrdfFileLoaded={handleUrdfFileLoaded}
            lastMeshFolderName={lastMeshFolderName}
          />
        </div>
      )}

      {/* Settings panel — always on the right edge */}
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
      const urdfTopic = savedConfig.urdfSourceMode === "file" ? "" : (savedConfig.urdfTopic || DEFAULT_CONFIG.urdfTopic);
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
