import * as THREE from "three";
import { TilesRenderer, GlobeControls } from "3d-tiles-renderer";
import {
  GoogleCloudAuthPlugin,
  UpdateOnChangePlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
} from "3d-tiles-renderer/plugins";
import URDFLoader from "urdf-loader";
import { WGS84_ELLIPSOID, DEG2RAD } from "./constants";
import { GlobeTransformer } from "./systems/GlobeTransformer";

// ==================== 3D SCENE MANAGER ====================

export class ThreeDSceneManager {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tilesRenderer: TilesRenderer | null = null;
  controls: GlobeControls | null = null;
  robotMarker: THREE.Mesh | null = null;
  trailLine: THREE.Line | null = null;
  trailPositions: THREE.Vector3[] = [];
  animationId: number | null = null;
  container: HTMLDivElement;
  clock: THREE.Clock;
  isDisposed = false;

  // URDF
  urdfRobot: any = null;
  urdfGroup: THREE.Group | null = null;
  urdfLoaded = false;
  currentUrdfXml = "";

  // Local file map for blob URLs (URDF meshes)
  private localFileMap: Map<string, string> = new Map();
  private lastMeshServerUrl = "";

  // Custom tileset state
  private customTilesBlobUrls: string[] = []; // Track for cleanup
  private currentMapSource: "google" | "custom" = "google";

  // Ground raycasting
  private raycaster = new THREE.Raycaster();
  private lastGroundECEF: THREE.Vector3 | null = null; // smoothed ground ECEF point
  private cachedGroundECEF: THREE.Vector3 | null = null; // per-frame cached result
  private cachedGroundKey = ""; // lat,lon key for cache invalidation

  // TF visualization
  private tfVisualGroup: THREE.Group = new THREE.Group();
  private tfAxesCache: Map<string, THREE.AxesHelper> = new Map();
  private tfLineCache: Map<string, THREE.Line> = new Map();
  private tfVisualsAdded = false;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.clock = new THREE.Clock();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x111111);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      1,
      1e12,
    );
    // Start camera far from Earth center - will jump to robot on first GPS
    this.camera.position.set(0, 0, 2e7);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(1, 2, 3).normalize();
    this.scene.add(dirLight);

    // Secondary light from below for URDF visibility
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight2.position.set(-1, -1, -1).normalize();
    this.scene.add(dirLight2);
  }

  initTiles(apiKey: string): void {
    if (this.tilesRenderer) {
      this.disposeTiles();
    }

    this.tilesRenderer = new TilesRenderer();
    this.tilesRenderer.registerPlugin(
      new GoogleCloudAuthPlugin({ apiToken: apiKey, useRecommendedSettings: true }),
    );
    this.tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
    this.tilesRenderer.registerPlugin(new TileCompressionPlugin());
    this.tilesRenderer.registerPlugin(new GLTFExtensionsPlugin());

    this.tilesRenderer.setCamera(this.camera);
    this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);

    this.scene.add(this.tilesRenderer.group);

    this.controls = new GlobeControls(
      this.scene,
      this.camera,
      this.renderer.domElement,
      this.tilesRenderer,
    );
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
  }

  // ========== Custom Local Tileset Methods ==========

  /**
   * Load a local tileset from browser files.
   * Finds tileset.json, patches all content URIs to blob URLs,
   * then creates a TilesRenderer pointing at the patched tileset.
   */
  loadLocalTileset(fileList: FileList): void {
    // Build a map of relative paths to File objects
    const filesByPath = new Map<string, File>();
    let rootFolder = "";
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]!;
      const path = (file as any).webkitRelativePath || file.name;
      if (!rootFolder && path.includes("/")) {
        rootFolder = path.split("/")[0]!;
      }
      filesByPath.set(path, file);
    }

    // Find tileset.json
    let tilesetPath = "";
    let tilesetFile: File | null = null;
    for (const [path, file] of filesByPath) {
      const name = path.split("/").pop()?.toLowerCase();
      if (name === "tileset.json") {
        tilesetPath = path;
        tilesetFile = file;
        break;
      }
    }

    if (!tilesetFile) {
      console.error("[CustomTiles] No tileset.json found in selected folder");
      return;
    }

    // Get the directory containing tileset.json for resolving relative paths
    const tilesetDir = tilesetPath.includes("/")
      ? tilesetPath.substring(0, tilesetPath.lastIndexOf("/"))
      : "";

    // Read tileset.json
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const tilesetJson = JSON.parse(reader.result as string);

        // Strip embedded georeference so our updateMapTransform controls placement
        if (tilesetJson.root && tilesetJson.root.transform) {
          console.log("[CustomTiles] Stripping root.transform to reset georeference");
          delete tilesetJson.root.transform;
        }

        // Revoke old blob URLs
        this.revokeCustomBlobUrls();

        // Create blob URLs for all non-json files (b3dm, glb, etc.)
        const blobUrlMap = new Map<string, string>();
        for (const [path, file] of filesByPath) {
          if (path === tilesetPath) continue; // Will handle tileset.json separately
          const blobUrl = URL.createObjectURL(file);
          this.customTilesBlobUrls.push(blobUrl);
          // Store relative path from tileset.json directory
          let relativePath = path;
          if (tilesetDir && path.startsWith(tilesetDir + "/")) {
            relativePath = path.substring(tilesetDir.length + 1);
          }
          blobUrlMap.set(relativePath, blobUrl);
          // Also store just the filename for fallback matching
          const filename = path.split("/").pop()!;
          if (!blobUrlMap.has(filename)) {
            blobUrlMap.set(filename, blobUrl);
          }
        }

        // Patch tileset JSON: replace all content URIs with blob URLs
        this.patchTilesetUris(tilesetJson, blobUrlMap);

        // Create blob URL for the patched tileset.json
        const patchedJson = JSON.stringify(tilesetJson);
        const tilesetBlob = new Blob([patchedJson], { type: "application/json" });
        const tilesetBlobUrl = URL.createObjectURL(tilesetBlob);
        this.customTilesBlobUrls.push(tilesetBlobUrl);

        console.log(`[CustomTiles] Patched tileset with ${blobUrlMap.size} blob URLs`);

        // Dispose current tiles and load the custom tileset
        this.disposeTiles();
        this.currentMapSource = "custom";

        this.tilesRenderer = new TilesRenderer(tilesetBlobUrl);
        this.tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
        this.tilesRenderer.registerPlugin(new TileCompressionPlugin());
        this.tilesRenderer.registerPlugin(new GLTFExtensionsPlugin());

        this.tilesRenderer.setCamera(this.camera);
        this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);

        this.scene.add(this.tilesRenderer.group);

        this.controls = new GlobeControls(
          this.scene,
          this.camera,
          this.renderer.domElement,
          this.tilesRenderer,
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.15;

        console.log(`[CustomTiles] Local tileset loaded from: ${rootFolder}`);
      } catch (err) {
        console.error("[CustomTiles] Failed to parse tileset.json:", err);
      }
    };
    reader.readAsText(tilesetFile);
  }

  /**
   * Recursively patch content.uri / content.url fields in tileset JSON
   * with corresponding blob URLs.
   */
  private patchTilesetUris(obj: any, blobUrlMap: Map<string, string>): void {
    if (!obj || typeof obj !== "object") return;

    if (obj.content) {
      const uriField = obj.content.uri || obj.content.url;
      if (typeof uriField === "string") {
        // Try exact match, then decoded match, then filename-only match
        const decoded = decodeURIComponent(uriField);
        const filename = uriField.split("/").pop()!;
        const decodedFilename = decodeURIComponent(filename);
        const blobUrl =
          blobUrlMap.get(uriField) ||
          blobUrlMap.get(decoded) ||
          blobUrlMap.get(filename) ||
          blobUrlMap.get(decodedFilename);
        if (blobUrl) {
          if (obj.content.uri) obj.content.uri = blobUrl;
          if (obj.content.url) obj.content.url = blobUrl;
        }
      }
    }

    // Recurse into children, root, etc.
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) {
        this.patchTilesetUris(child, blobUrlMap);
      }
    }
    if (obj.root) {
      this.patchTilesetUris(obj.root, blobUrlMap);
    }
  }

  /**
   * Revoke all blob URLs created for custom tiles.
   */
  private revokeCustomBlobUrls(): void {
    for (const url of this.customTilesBlobUrls) {
      URL.revokeObjectURL(url);
    }
    this.customTilesBlobUrls = [];
  }

  /**
   * Position the custom tileset on the globe using lat/lon/alt/heading/scale.
   * For Google tiles this is a no-op (Google tiles are already ECEF-positioned).
   */
  updateMapTransform(
    mapSource: "google" | "custom",
    lat: number,
    lon: number,
    alt: number,
    heading: number,
    scale: number,
  ): void {
    if (!this.tilesRenderer) return;

    if (mapSource === "google") {
      // Google tiles are natively ECEF — identity transform
      this.tilesRenderer.group.position.set(0, 0, 0);
      this.tilesRenderer.group.quaternion.identity();
      this.tilesRenderer.group.scale.set(1, 1, 1);
      return;
    }

    // Custom tiles: place at given lat/lon/alt on the globe
    const latRad = lat * DEG2RAD;
    const lonRad = lon * DEG2RAD;

    // Get ECEF position for the given coordinates
    const ecefPos = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, alt, ecefPos);

    // Build ENU frame at this location
    const up = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);
    const northPole = new THREE.Vector3(0, 0, 1);
    const east = new THREE.Vector3().crossVectors(northPole, up).normalize();
    if (east.lengthSq() < 0.001) east.set(1, 0, 0);
    const north = new THREE.Vector3().crossVectors(up, east).normalize();

    // ENU rotation matrix (East=X, North=Y, Up=Z in local space)
    const enuMatrix = new THREE.Matrix4().makeBasis(east, north, up);
    const enuQuat = new THREE.Quaternion().setFromRotationMatrix(enuMatrix);

    // Apply heading rotation around the up (Z) axis
    const headingQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      heading * DEG2RAD,
    );
    // Final orientation: ENU × heading
    const finalQuat = enuQuat.multiply(headingQuat);

    this.tilesRenderer.group.position.copy(ecefPos);
    this.tilesRenderer.group.quaternion.copy(finalQuat);
    this.tilesRenderer.group.scale.setScalar(scale);
  }

  /**
   * Get the Fixed Frame origin as geographic coordinates.
   * Delegates to the GlobeTransformer passed by the caller.
   */
  getFixedFrameLocation(transformer: GlobeTransformer): { lat: number; lon: number; alt: number } | null {
    return transformer.getFixedFrameGeographic();
  }

  // ========== URDF Methods ==========

  setLocalFiles(files: Map<string, string>): void {
    // Revoke old blob URLs to free memory
    for (const url of this.localFileMap.values()) {
      URL.revokeObjectURL(url);
    }
    this.localFileMap = files;
    console.log(`[LocalFiles] Updated local file map: ${files.size} files`);

    // If URDF already loaded, reload it so the new meshes appear
    if (this.currentUrdfXml && this.lastMeshServerUrl) {
      const xml = this.currentUrdfXml;
      const url = this.lastMeshServerUrl;
      // Force reload by clearing state
      this.currentUrdfXml = "";
      this.urdfLoaded = false;
      this.loadUrdf(xml, url);
    }
  }

  private resolveUrl(url: string): string {
    // 1. Clean the path (remove prefixes for matching)
    let cleanPath = url;
    if (cleanPath.startsWith("package://")) {
      cleanPath = cleanPath.substring("package://".length);
    } else if (cleanPath.startsWith("file://")) {
      cleanPath = cleanPath.substring("file://".length);
    }

    // 2. Try to find in Local Files (blob URLs)
    if (this.localFileMap.size > 0) {
      // Exact match
      if (this.localFileMap.has(cleanPath)) {
        return this.localFileMap.get(cleanPath)!;
      }

      // Fuzzy match
      for (const [filePath, blobUrl] of this.localFileMap) {
        if (filePath.endsWith(cleanPath) || cleanPath.endsWith(filePath)) {
          return blobUrl;
        }
        // Match filename only
        const urlFilename = cleanPath.split("/").pop()?.toLowerCase();
        const localFilename = filePath.split("/").pop()?.toLowerCase();
        if (urlFilename && localFilename && urlFilename === localFilename) {
          return blobUrl;
        }
      }
    }

    // 3. FALLBACK: If not found locally, use the Mesh Server
    // Rewrites package://robot_description/meshes/X.STL
    //      -> http://localhost:9090/robot_description/meshes/X.STL
    if (url.startsWith("package://")) {
      const server = this.lastMeshServerUrl.replace(/\/$/, "");
      const path = cleanPath.startsWith("/") ? cleanPath.substring(1) : cleanPath;
      return `${server}/${path}`;
    }

    return url;
  }

  loadUrdf(urdfXml: string, meshServerUrl: string): void {
    // Skip if same URDF already loaded
    if (this.currentUrdfXml === urdfXml && this.urdfLoaded) return;
    this.currentUrdfXml = urdfXml;
    this.lastMeshServerUrl = meshServerUrl;

    // Remove existing URDF
    this.removeUrdf();

    // Set up LoadingManager with URL modifier to intercept mesh requests
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url: string) => {
      const resolved = this.resolveUrl(url);
      if (resolved !== url) {
        console.log(`[URDF] Resolved mesh: ${url} -> blob URL`);
      }
      return resolved;
    });

    const loader = new URDFLoader(loadingManager);
    loader.parseCollision = false;
    loader.parseVisual = true;

    // Resolve package:// URLs to HTTP URLs (fallback when no local files)
    // package://robot_pkg/meshes/X.STL -> http://localhost:9090/robot_pkg/meshes/X.STL
    // urdf-loader calls packages(packageName) and appends "/" + remainingPath,
    // so we return the base URL with the package directory included.
    loader.packages = (packageName: string): string => {
      return meshServerUrl.replace(/\/$/, "") + "/" + packageName;
    };

    try {
      const robot = loader.parse(urdfXml);
      this.urdfRobot = robot;

      // Create a group for globe positioning
      this.urdfGroup = new THREE.Group();
      this.urdfGroup.add(robot);
      this.scene.add(this.urdfGroup);
      this.urdfLoaded = true;

      const jointCount = Object.keys(robot.joints || {}).length;
      const linkCount = Object.keys(robot.links || {}).length;
      console.log(
        `[URDF] Robot loaded: ${linkCount} links, ${jointCount} joints (local files: ${this.localFileMap.size})`,
      );
    } catch (err) {
      console.error("[URDF] Failed to parse URDF:", err);
    }
  }

  /**
   * Raycast downward from a lat/lon to find the ground elevation on 3D tiles.
   * Returns the ECEF intersection point, or null if no ground found.
   */
  getGroundPosition(lat: number, lon: number): THREE.Vector3 | null {
    if (!this.tilesRenderer) return null;

    // Return cached result if same position (multiple calls per frame)
    const key = `${lat.toFixed(8)},${lon.toFixed(8)}`;
    if (key === this.cachedGroundKey && this.cachedGroundECEF) {
      return this.cachedGroundECEF.clone();
    }

    const latRad = lat * DEG2RAD;
    const lonRad = lon * DEG2RAD;

    // Get surface normal ("up" direction)
    const up = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);

    // Start ray from 5000m above the ellipsoid surface
    const origin = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, 5000, origin);

    // Ray downward
    const direction = up.clone().negate();

    this.raycaster.set(origin, direction);
    this.raycaster.far = 2000;
    this.raycaster.firstHitOnly = true;

    // Collect visible tile meshes only (skip non-visible/loading tiles)
    const intersects = this.raycaster.intersectObject(this.tilesRenderer.group, true);
    if (intersects.length > 0) {
      const hit = intersects[0]!.point.clone();

      // Smooth the ground position to avoid jitter from LOD changes
      if (this.lastGroundECEF) {
        this.lastGroundECEF.lerp(hit, 0.3);
      } else {
        this.lastGroundECEF = hit;
      }
      this.cachedGroundKey = key;
      this.cachedGroundECEF = this.lastGroundECEF.clone();
      return this.cachedGroundECEF.clone();
    }
    // No hit — return last known good
    const fallback = this.lastGroundECEF?.clone() ?? null;
    if (fallback) {
      this.cachedGroundKey = key;
      this.cachedGroundECEF = fallback;
    }
    return fallback;
  }

  /**
   * Position URDF using the transformer (same coordinate system as TF frames and layers).
   * This ensures the robot and TF frames are always visually consistent.
   */
  positionUrdfViaTransformer(transformer: GlobeTransformer): void {
    if (!this.urdfGroup) return;

    const pos = transformer.transformToGlobe(new THREE.Vector3(), transformer.displayFrame);
    if (!pos) return;

    const quat = transformer.transformOrientationToGlobe(
      new THREE.Quaternion(0, 0, 0, 1), transformer.displayFrame,
    );
    if (!quat) return;

    this.urdfGroup.position.copy(pos);
    this.urdfGroup.quaternion.copy(quat);

    // Force matrix update so TF visualization reads correct matrices
    this.urdfGroup.updateMatrixWorld(true);
  }

  /**
   * Position an object at an ECEF position derived from the transformer.
   */
  positionObjectViaTransformer(
    object: THREE.Object3D,
    transformer: GlobeTransformer,
    frame: string,
    offsetUp: number = 0,
  ): void {
    const pos = transformer.transformToGlobe(new THREE.Vector3(0, 0, offsetUp), frame);
    if (!pos) return;
    object.position.copy(pos);
  }

  updateJointValues(names: string[], positions: number[]): void {
    if (!this.urdfRobot) return;
    for (let i = 0; i < names.length && i < positions.length; i++) {
      const joint = this.urdfRobot.joints?.[names[i]];
      if (joint) {
        joint.setJointValue(positions[i]!);
      }
    }
  }

  setUrdfOpacity(opacity: number): void {
    if (!this.urdfRobot) return;
    this.urdfRobot.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat: THREE.Material) => {
            (mat as THREE.MeshStandardMaterial).transparent = opacity < 1;
            (mat as THREE.MeshStandardMaterial).opacity = opacity;
          });
        } else if (mesh.material) {
          (mesh.material as THREE.MeshStandardMaterial).transparent = opacity < 1;
          (mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
        }
      }
    });
  }

  setUrdfVisible(visible: boolean): void {
    if (this.urdfGroup) {
      this.urdfGroup.visible = visible;
    }
  }

  removeUrdf(): void {
    if (this.urdfGroup) {
      this.scene.remove(this.urdfGroup);
      this.urdfGroup.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else if (mesh.material) {
            mesh.material.dispose();
          }
        }
      });
      this.urdfGroup = null;
      this.urdfRobot = null;
      this.urdfLoaded = false;
      this.currentUrdfXml = "";
    }
  }

  // ========== TF Visualization Methods ==========

  /**
   * Update TF frame visualization on the globe.
   * Uses the transformer to position all frames (same coordinate system as path/layers).
   */
  updateTfVisualization(
    transformer: GlobeTransformer,
    tfSize: number,
  ): void {
    if (!this.tfVisualsAdded) {
      this.scene.add(this.tfVisualGroup);
      this.tfVisualsAdded = true;
    }

    const tfSystem = transformer.tfSystem;
    const frameIds = tfSystem.getFrameIds();
    const activeFrames = new Set<string>();
    const framePositions = new Map<string, THREE.Vector3>();

    for (const frameId of frameIds) {
      // Use transformer to get ECEF position (same path as layers → consistent)
      const pos = transformer.transformToGlobe(new THREE.Vector3(), frameId);
      if (!pos) continue;

      const orientQuat = transformer.transformOrientationToGlobe(
        new THREE.Quaternion(0, 0, 0, 1), frameId,
      );
      if (!orientQuat) continue;

      activeFrames.add(frameId);
      framePositions.set(frameId, pos.clone());

      // Scale axes based on camera distance for constant visual size
      const dist = this.camera.position.distanceTo(pos);
      const axesScale = Math.max(0.1, dist * 0.002) * tfSize;

      // Get or create AxesHelper
      let axes = this.tfAxesCache.get(frameId);
      if (!axes) {
        axes = new THREE.AxesHelper(1);
        axes.renderOrder = 1000;
        (axes.material as THREE.LineBasicMaterial).depthTest = false;
        this.tfVisualGroup.add(axes);
        this.tfAxesCache.set(frameId, axes);
      }
      axes.position.copy(pos);
      axes.quaternion.copy(orientQuat);
      axes.scale.setScalar(axesScale);
      axes.visible = true;
    }

    // Draw yellow lines from each child to its parent
    for (const frameId of activeFrames) {
      const parentId = transformer.tfSystem.getParentId(frameId);
      if (!parentId || !framePositions.has(parentId) || !framePositions.has(frameId)) {
        const line = this.tfLineCache.get(frameId);
        if (line) line.visible = false;
        continue;
      }

      const childPos = framePositions.get(frameId)!;
      const parentPos = framePositions.get(parentId)!;

      let line = this.tfLineCache.get(frameId);
      if (!line) {
        const geom = new THREE.BufferGeometry();
        const mat = new THREE.LineBasicMaterial({
          color: 0xffff00,
          depthTest: false,
          linewidth: 2,
        });
        line = new THREE.Line(geom, mat);
        line.renderOrder = 999;
        this.tfVisualGroup.add(line);
        this.tfLineCache.set(frameId, line);
      }

      const positions = new Float32Array([
        childPos.x, childPos.y, childPos.z,
        parentPos.x, parentPos.y, parentPos.z,
      ]);
      line.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      line.geometry.attributes.position!.needsUpdate = true;
      line.visible = true;
    }

    // Hide visuals for frames no longer in the tree
    for (const [id, axes] of this.tfAxesCache) {
      if (!activeFrames.has(id)) axes.visible = false;
    }
    for (const [id, line] of this.tfLineCache) {
      if (!activeFrames.has(id)) line.visible = false;
    }
  }

  setTfVisible(visible: boolean): void {
    this.tfVisualGroup.visible = visible;
  }

  removeTfVisualization(): void {
    for (const axes of this.tfAxesCache.values()) {
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
    }
    for (const line of this.tfLineCache.values()) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.tfAxesCache.clear();
    this.tfLineCache.clear();

    if (this.tfVisualsAdded) {
      this.scene.remove(this.tfVisualGroup);
      this.tfVisualsAdded = false;
    }
    this.tfVisualGroup = new THREE.Group();
  }

  // ========== Robot Marker Methods ==========

  createRobotMarker(): void {
    if (this.robotMarker) return;
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false,
    });
    this.robotMarker = new THREE.Mesh(geometry, material);
    this.robotMarker.renderOrder = 999;
    this.scene.add(this.robotMarker);
  }

  /**
   * Update robot marker position using the transformer (consistent with TF/layers).
   */
  updateRobotMarkerViaTransformer(transformer: GlobeTransformer): void {
    if (!this.robotMarker) this.createRobotMarker();
    if (!this.robotMarker) return;

    // Position marker at displayFrame + small up offset for visibility
    const target = transformer.transformToGlobe(
      new THREE.Vector3(0, 0, 0.5), transformer.displayFrame,
    );
    if (!target) return;

    this.robotMarker.position.copy(target);

    const dist = this.camera.position.distanceTo(target);
    const scale = Math.max(0.3, dist * 0.0008);
    this.robotMarker.scale.setScalar(scale);
  }

  /**
   * Update trail using the transformer (consistent with TF/layers).
   */
  updateTrailViaTransformer(transformer: GlobeTransformer): void {
    // Position trail point at displayFrame + small up offset
    const point = transformer.transformToGlobe(
      new THREE.Vector3(0, 0, 0.3), transformer.displayFrame,
    );
    if (!point) return;

    this.trailPositions.push(point.clone());
    if (this.trailPositions.length > 500) this.trailPositions.shift();

    if (this.trailLine) {
      this.scene.remove(this.trailLine);
      this.trailLine.geometry.dispose();
    }

    if (this.trailPositions.length >= 2) {
      const geometry = new THREE.BufferGeometry().setFromPoints(this.trailPositions);
      const material = new THREE.LineBasicMaterial({
        color: 0x00aaff,
        linewidth: 2,
        depthTest: false,
      });
      this.trailLine = new THREE.Line(geometry, material);
      this.trailLine.renderOrder = 998;
      this.scene.add(this.trailLine);
    }
  }

  clearTrail(): void {
    if (this.trailLine) {
      this.scene.remove(this.trailLine);
      this.trailLine.geometry.dispose();
      this.trailLine = null;
    }
    this.trailPositions = [];
  }

  removeRobotMarker(): void {
    if (this.robotMarker) {
      this.scene.remove(this.robotMarker);
      this.robotMarker.geometry.dispose();
      (this.robotMarker.material as THREE.Material).dispose();
      this.robotMarker = null;
    }
  }

  // ========== Camera Methods ==========

  /**
   * Follow mode: translate camera by the ECEF delta the robot moved.
   * Uses transformer-derived positions so camera and robot agree.
   */
  followRobotEcef(prevEcef: THREE.Vector3, newEcef: THREE.Vector3): void {
    const delta = new THREE.Vector3().subVectors(newEcef, prevEcef);
    this.camera.position.add(delta);
    this.camera.updateMatrixWorld();
  }

  /**
   * Initial camera placement: set view looking at robot from above.
   */
  setInitialView(lat: number, lon: number): void {
    const latRad = lat * DEG2RAD;
    const lonRad = lon * DEG2RAD;

    const surfacePos = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, 0, surfacePos);

    const up = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);

    const north = new THREE.Vector3(0, 0, 1);
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const correctedNorth = new THREE.Vector3().crossVectors(up, east).normalize();

    // Default: 200m above, looking down at ~45 degrees from the south
    const cameraPos = new THREE.Vector3()
      .copy(surfacePos)
      .addScaledVector(up, 141)
      .addScaledVector(correctedNorth, -141);

    this.camera.position.copy(cameraPos);
    this.camera.lookAt(surfacePos);
    this.camera.updateMatrixWorld();
  }

  // ========== Lifecycle ==========

  resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    if (this.tilesRenderer) {
      this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
    }
  }

  startRenderLoop(): void {
    const animate = (): void => {
      if (this.isDisposed) return;
      this.animationId = requestAnimationFrame(animate);

      const delta = this.clock.getDelta();
      if (this.tilesRenderer) this.tilesRenderer.update();
      if (this.controls) this.controls.update(delta);
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  disposeTiles(): void {
    if (this.tilesRenderer) {
      this.scene.remove(this.tilesRenderer.group);
      this.tilesRenderer.dispose();
      this.tilesRenderer = null;
    }
    if (this.controls) {
      this.controls.detach();
      this.controls = null;
    }
  }

  dispose(): void {
    this.isDisposed = true;
    if (this.animationId != null) cancelAnimationFrame(this.animationId);
    this.disposeTiles();
    this.revokeCustomBlobUrls();
    this.removeRobotMarker();
    this.clearTrail();
    this.removeUrdf();
    this.removeTfVisualization();

    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
