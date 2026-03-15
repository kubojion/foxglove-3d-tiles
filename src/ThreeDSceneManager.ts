import * as THREE from "three";
import { TilesRenderer, GlobeControls } from "3d-tiles-renderer";
import {
  GoogleCloudAuthPlugin,
  UpdateOnChangePlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import URDFLoader from "urdf-loader";
import { WGS84_ELLIPSOID, DEG2RAD } from "./constants";
import { GlobeTransformer } from "./systems/GlobeTransformer";
import { OSMTileSystem } from "./systems/OSMTileSystem";

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

  // Grid overlay
  private gridGroup: THREE.Group | null = null;
  private gridAdded = false;

  // Custom tileset state
  private customTilesBlobUrls: string[] = []; // Track for cleanup
  private currentMapSource: "google" | "custom" | "osm" = "google";

  // OSM 2D map
  osmTileSystem: OSMTileSystem | null = null;
  mapControls: MapControls | null = null;
  private osmMode = false;
  private osmRightClickHandler: ((e: PointerEvent) => void) | null = null;

  // Ground raycasting
  private raycaster = new THREE.Raycaster();
  private lastGroundECEF: THREE.Vector3 | null = null; // smoothed ground ECEF point
  private cachedGroundECEF: THREE.Vector3 | null = null; // per-frame cached result
  private cachedGroundKey = ""; // lat,lon key for cache invalidation

  // TF visualization
  private tfVisualGroup: THREE.Group = new THREE.Group();
  private tfAxesCache: Map<string, THREE.AxesHelper> = new Map();
  private tfLineCache: Map<string, THREE.Line> = new Map();
  private tfLabelCache: Map<string, THREE.Sprite> = new Map();
  private tfVisualsAdded = false;

  // Local origin group: all custom geometry (URDF, markers, TF, layers, trails)
  // is added here. The group is positioned at anchor ECEF with ENU rotation,
  // so children use small local-ENU coordinates (full Float32 precision).
  localOriginGroup: THREE.Group = new THREE.Group();
  private localOriginAdded = false;

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
    // useRecommendedSettings: true sets errorTarget=20 (Google's recommended baseline).
    // We override it after load-tileset fires so the plugin doesn't clobber our value.
    this.tilesRenderer.registerPlugin(
      new GoogleCloudAuthPlugin({ apiToken: apiKey, useRecommendedSettings: true }),
    );
    this.tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
    this.tilesRenderer.registerPlugin(new TileCompressionPlugin());
    this.tilesRenderer.registerPlugin(new GLTFExtensionsPlugin());

    // Apply anisotropic filtering to tile textures for sharper viewing at angles
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.tilesRenderer.addEventListener("load-model", (event: { scene: THREE.Group }) => {
      event.scene.traverse((child: any) => {
        if (child.material) {
          const mat = child.material;
          for (const key in mat) {
            const val = mat[key];
            if (val && val.isTexture) {
              val.anisotropy = maxAniso;
            }
          }
        }
      });
    });

    // Override errorTarget AFTER the root tileset loads, so that
    // GoogleCloudAuthPlugin's useRecommendedSettings doesn't clobber it.
    this.tilesRenderer.addEventListener("load-root-tileset", () => {
      if (this.tilesRenderer && this._pendingErrorTarget != null) {
        this.tilesRenderer.errorTarget = this._pendingErrorTarget;
      }
    });

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
    // Keep camera above tile surface (like Google Earth)
    this.controls.adjustHeight = true;
    this.controls.cameraRadius = 5;
    this.controls.minDistance = 1;
  }

  /**
   * Set the rendering quality for 3D tiles.
   * errorTarget controls the screen-space error threshold in pixels:
   *   6  = highest detail the API provides (may be slow)
   *   12 = balanced (default)
   *   20 = Google's recommended baseline (fast, lower detail)
   *
   * NOTE: Google's public Photorealistic 3D Tiles API does NOT serve the
   * highest LOD available in Google Earth / Google Maps. This is a known
   * API limitation confirmed by Google (see NASA-AMMOS/3DTilesRendererJS#747).
   * errorTarget below ~6 won't improve visuals, only increase load.
   */
  setTileQuality(errorTarget: number): void {
    this._pendingErrorTarget = errorTarget;
    if (this.tilesRenderer) {
      this.tilesRenderer.errorTarget = errorTarget;
    }
  }

  /** Get Google Maps data attribution strings from currently visible tiles. */
  getGoogleAttributions(): string[] {
    if (!this.tilesRenderer) return [];
    const target: { value: string; type: string }[] = [];
    this.tilesRenderer.getAttributions(target);
    // Return only string-type attributions (skip logo entries)
    return target
      .filter((a) => a.type === "string" && a.value.trim().length > 0)
      .map((a) => a.value);
  }

  private _pendingErrorTarget: number = 12;
  private _useNativeGeoref = false;

  // ========== OSM 2D Map Methods ==========

  /**
   * Initialize OSM 2D map mode.
   * Sets up MapControls for top-down pan/zoom/rotate and the OSM tile system.
   * The localOriginGroup sits at scene origin — no ECEF positioning.
   */
  initOSM(zoom: number): void {
    // Clean up any 3D tiles
    this.disposeTiles();

    this.osmMode = true;
    this.currentMapSource = "osm";

    // Create OSM tile system
    if (!this.osmTileSystem) {
      this.osmTileSystem = new OSMTileSystem();
    }
    this.osmTileSystem.setZoom(zoom);

    // Add OSM tiles group to localOriginGroup (so they share the same coordinate space)
    if (!this.localOriginGroup.children.includes(this.osmTileSystem.getGroup())) {
      this.localOriginGroup.add(this.osmTileSystem.getGroup());
    }

    // For OSM mode, localOriginGroup is at scene origin with identity transform
    if (!this.localOriginAdded) {
      this.scene.add(this.localOriginGroup);
      this.localOriginAdded = true;
    }
    this.localOriginGroup.position.set(0, 0, 0);
    this.localOriginGroup.quaternion.identity();
    this.localOriginGroup.updateMatrixWorld(true);

    // Set up MapControls — matches GlobeControls behavior:
    //   Left mouse  = pan (drag the map)
    //   Right mouse = orbit/rotate around target
    //   Scroll      = zoom
    // MapControls inherits from OrbitControls but swaps left=pan, right=rotate by default.
    if (this.mapControls) {
      this.mapControls.dispose();
    }
    this.mapControls = new MapControls(this.camera, this.renderer.domElement);
    this.mapControls.enableDamping = true;
    this.mapControls.dampingFactor = 0.15;
    this.mapControls.screenSpacePanning = true;
    this.mapControls.enableRotate = true;
    this.mapControls.minPolarAngle = 0.1; // Nearly top-down but not exactly (avoids gimbal lock)
    this.mapControls.maxPolarAngle = Math.PI * 0.48; // Can look almost to the horizon but not below
    this.mapControls.minDistance = 5;
    this.mapControls.maxDistance = 5000;
    // MapControls default: LEFT=PAN, MIDDLE=DOLLY, RIGHT=ROTATE — same as GlobeControls
    // Invert rotation direction to match GlobeControls "grab and spin" behavior
    this.mapControls.rotateSpeed = -1;

    // Right-click rotation pivot: raycast to ground plane to set orbit center,
    // matching GlobeControls which orbits around the clicked surface point.
    if (this.osmRightClickHandler) {
      this.renderer.domElement.removeEventListener("pointerdown", this.osmRightClickHandler);
    }
    this.osmRightClickHandler = (e: PointerEvent) => {
      if (e.button !== 2 || !this.mapControls?.enabled) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = this.raycastGridPlane(ndcX, ndcY, 0);
      if (hit) {
        this.mapControls!.target.copy(hit);
      }
    };
    this.renderer.domElement.addEventListener("pointerdown", this.osmRightClickHandler);

    // Start camera looking at origin from above + slightly south (like 3D initial view)
    this.camera.up.set(0, 0, 1); // Z is up in ENU
    this.camera.position.set(0, -40, 40);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = 0.1;
    this.camera.far = 50000;
    this.camera.updateProjectionMatrix();

    this.mapControls.target.set(0, 0, 0);
    this.mapControls.update(0);

    // Add ground clipping plane — hides anything below Z=0
    this.renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.01)];
    this.renderer.localClippingEnabled = true;

    this.renderer.setClearColor(0x1a1a2e);

    console.log("[OSM] 2D map mode initialized, zoom=" + zoom);
  }

  disposeOSM(): void {
    if (this.osmRightClickHandler) {
      this.renderer.domElement.removeEventListener("pointerdown", this.osmRightClickHandler);
      this.osmRightClickHandler = null;
    }
    if (this.osmTileSystem) {
      this.localOriginGroup.remove(this.osmTileSystem.getGroup());
      this.osmTileSystem.dispose();
      this.osmTileSystem = null;
    }
    if (this.mapControls) {
      this.mapControls.dispose();
      this.mapControls = null;
    }
    this.osmMode = false;
    // Remove clipping planes
    this.renderer.clippingPlanes = [];
    this.renderer.localClippingEnabled = false;
    this.renderer.setClearColor(0x111111);
  }

  isOSMMode(): boolean {
    return this.osmMode;
  }

  /**
   * Update OSM tile loading and camera position for 2D mode.
   * `robotLocalPos` is the robot's position in local ENU (used for follow mode).
   */
  updateOSM(robotLocalPos: THREE.Vector3 | null, zoom: number): void {
    if (!this.osmTileSystem || !this.osmMode) return;
    this.osmTileSystem.setZoom(zoom);
    this.osmTileSystem.update(robotLocalPos);
  }

  /**
   * In OSM mode, update localOriginGroup to identity (no ECEF positioning).
   * This overrides the normal updateLocalOrigin behavior.
   */
  updateLocalOriginForOSM(): void {
    if (!this.localOriginAdded) {
      this.scene.add(this.localOriginGroup);
      this.localOriginAdded = true;
    }
    this.localOriginGroup.position.set(0, 0, 0);
    this.localOriginGroup.quaternion.identity();
    this.localOriginGroup.updateMatrixWorld(true);
  }

  // ========== Custom Local Tileset Methods ==========

  /**
   * Load a local tileset from browser files.
   * Finds tileset.json, patches all content URIs to blob URLs,
   * then creates a TilesRenderer pointing at the patched tileset.
   */
  loadLocalTileset(fileList: FileList, useNativeGeorefParam = false): void {
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

    // Find tileset JSON: first try tileset.json, then any .json file at the shallowest level
    let tilesetPath = "";
    let tilesetFile: File | null = null;
    let fallbackPath = "";
    let fallbackFile: File | null = null;
    let fallbackDepth = Infinity;
    for (const [path, file] of filesByPath) {
      const name = path.split("/").pop()?.toLowerCase();
      if (name === "tileset.json") {
        tilesetPath = path;
        tilesetFile = file;
        break;
      }
      if (name?.endsWith(".json") && name !== "package.json") {
        const depth = path.split("/").length;
        if (depth < fallbackDepth) {
          fallbackDepth = depth;
          fallbackPath = path;
          fallbackFile = file;
        }
      }
    }
    if (!tilesetFile && fallbackFile) {
      tilesetPath = fallbackPath;
      tilesetFile = fallbackFile;
      console.log(`[CustomTiles] No tileset.json found, using: ${fallbackPath}`);
    }

    if (!tilesetFile) {
      console.error("[CustomTiles] No tileset JSON found in selected folder");
      return;
    }

    // Get the directory containing tileset.json for resolving relative paths
    const tilesetDir = tilesetPath.includes("/")
      ? tilesetPath.substring(0, tilesetPath.lastIndexOf("/"))
      : "";

    // Read and process the tileset (async for reading all JSON files)
    this.loadLocalTilesetAsync(tilesetFile, tilesetPath, tilesetDir, filesByPath, useNativeGeorefParam, rootFolder);
  }

  /**
   * Async implementation of loadLocalTileset.
   * Recursively patches the entire tileset JSON graph, then loads.
   */
  private async loadLocalTilesetAsync(
    tilesetFile: File,
    tilesetPath: string,
    tilesetDir: string,
    filesByPath: Map<string, File>,
    useNativeGeorefParam: boolean,
    rootFolder: string,
  ): Promise<void> {
    try {
      // Normalize filesByPath: re-key everything relative to the tileset directory
      const normalizedFiles = new Map<string, File>();
      for (const [path, file] of filesByPath) {
        let rel = path;
        if (tilesetDir && path.startsWith(tilesetDir + "/")) {
          rel = path.substring(tilesetDir.length + 1);
        }
        normalizedFiles.set(this.normalizePath(rel), file);
      }

      // Find root tileset relative key
      let rootKey = tilesetPath;
      if (tilesetDir && tilesetPath.startsWith(tilesetDir + "/")) {
        rootKey = tilesetPath.substring(tilesetDir.length + 1);
      }
      rootKey = this.normalizePath(rootKey);

      // Check native georef before patching
      const tilesetText = await tilesetFile.text();
      const tilesetJsonPreview = JSON.parse(tilesetText);
      let useNativeGeoref = useNativeGeorefParam;

      if (tilesetJsonPreview.root?.transform) {
        if (!useNativeGeoref) {
          console.warn(
            "[CustomTiles] Tileset has root.transform (ECEF). " +
            "Forcing native georeference to keep bounding volumes aligned.",
          );
        }
        useNativeGeoref = true;
      }

      // Revoke old blob URLs
      this.revokeCustomBlobUrls();

      // Caches shared across the entire patching run
      const jsonBlobCache = new Map<string, string>();
      const fileBlobCache = new Map<string, string>();

      // Recursively patch the root tileset and all referenced child JSONs
      const rootBlobUrl = await this.buildPatchedJsonBlobUrl(
        rootKey,
        normalizedFiles,
        jsonBlobCache,
        fileBlobCache,
      );

      if (!rootBlobUrl) {
        console.error("[CustomTiles] Failed to build patched root tileset");
        return;
      }

      console.log(
        `[CustomTiles] Patched tileset graph: ${fileBlobCache.size} binary + ${jsonBlobCache.size} JSON blob URLs`,
      );

      // Dispose current tiles and load the custom tileset
      this.disposeTiles();
      this.currentMapSource = "custom";

      this.tilesRenderer = new TilesRenderer(rootBlobUrl);
      this.tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
      this.tilesRenderer.registerPlugin(new TileCompressionPlugin());
      this.tilesRenderer.registerPlugin(new GLTFExtensionsPlugin());
      this.tilesRenderer.registerPlugin(new TilesFadePlugin());

      // Keep active tiles in the scene for stable ground raycasting
      this.tilesRenderer.displayActiveTiles = true;

      // Log load errors so missing/broken child tiles are visible in console
      this.tilesRenderer.addEventListener(
        "load-error",
        (event: { url: string | URL; error: Error }) => {
          console.error("[CustomTiles] Tile load error:", event.error, event.url);
        },
      );

      // Apply anisotropic filtering for sharper textures
      const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
      this.tilesRenderer.addEventListener("load-model", (event: { scene: THREE.Group }) => {
        event.scene.traverse((child: any) => {
          if (child.material) {
            const mat = child.material;
            for (const key in mat) {
              const val = mat[key];
              if (val && val.isTexture) {
                val.anisotropy = maxAniso;
              }
            }
          }
        });
      });

      this.tilesRenderer.errorTarget = this._pendingErrorTarget;
      this.tilesRenderer.addEventListener("load-root-tileset", () => {
        if (this.tilesRenderer) {
          this.tilesRenderer.errorTarget = this._pendingErrorTarget;
        }
      });

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
      // Disable adjustHeight in custom mode — when local tiles disappear or
      // fail to stay active near the camera, GlobeControls loses a stable
      // surface reference and the camera becomes uncontrollable.
      this.controls.adjustHeight = false;
      this.controls.cameraRadius = 5;
      this.controls.minDistance = 1;

      this._useNativeGeoref = useNativeGeoref;

      console.log(`[CustomTiles] Local tileset loaded from: ${rootFolder} (nativeGeoref=${useNativeGeoref})`);
    } catch (err) {
      console.error("[CustomTiles] Failed to load tileset:", err);
    }
  }

  // ── Recursive JSON-aware tileset patcher ──

  private normalizePath(path: string): string {
    const cleaned = path.split("#")[0]!.split("?")[0]!;
    const parts = cleaned.split("/");
    const out: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") {
        out.pop();
      } else {
        out.push(part);
      }
    }
    return out.join("/");
  }

  private resolveRelativePath(baseFilePath: string, relativeUri: string): string {
    const baseDir = baseFilePath.includes("/")
      ? baseFilePath.substring(0, baseFilePath.lastIndexOf("/"))
      : "";
    const decoded = decodeURIComponent(relativeUri);
    if (!baseDir) {
      return this.normalizePath(decoded);
    }
    return this.normalizePath(`${baseDir}/${decoded}`);
  }

  private async getBlobUrlForAsset(
    assetPath: string,
    filesByPath: Map<string, File>,
    fileBlobCache: Map<string, string>,
  ): Promise<string | null> {
    const normalized = this.normalizePath(assetPath);
    const cached = fileBlobCache.get(normalized);
    if (cached) return cached;

    const file = filesByPath.get(normalized);
    if (!file) {
      console.warn("[CustomTiles] Missing asset:", normalized);
      return null;
    }

    const blobUrl = URL.createObjectURL(file);
    fileBlobCache.set(normalized, blobUrl);
    this.customTilesBlobUrls.push(blobUrl);
    return blobUrl;
  }

  private async patchUriObject(
    uriOwner: any,
    currentJsonPath: string,
    filesByPath: Map<string, File>,
    jsonBlobCache: Map<string, string>,
    fileBlobCache: Map<string, string>,
  ): Promise<void> {
    if (!uriOwner) return;

    const rawUri = uriOwner.uri ?? uriOwner.url;
    if (typeof rawUri !== "string") return;

    const resolvedPath = this.resolveRelativePath(currentJsonPath, rawUri);
    const lower = resolvedPath.toLowerCase();

    let replacement: string | null = null;

    if (lower.endsWith(".json")) {
      replacement = await this.buildPatchedJsonBlobUrl(
        resolvedPath,
        filesByPath,
        jsonBlobCache,
        fileBlobCache,
      );
    } else {
      replacement = await this.getBlobUrlForAsset(
        resolvedPath,
        filesByPath,
        fileBlobCache,
      );
    }

    if (!replacement) return;

    if ("uri" in uriOwner) uriOwner.uri = replacement;
    if ("url" in uriOwner) uriOwner.url = replacement;
  }

  private async patchTilesetNode(
    node: any,
    currentJsonPath: string,
    filesByPath: Map<string, File>,
    jsonBlobCache: Map<string, string>,
    fileBlobCache: Map<string, string>,
  ): Promise<void> {
    if (!node || typeof node !== "object") return;

    // Patch content
    if (node.content) {
      await this.patchUriObject(node.content, currentJsonPath, filesByPath, jsonBlobCache, fileBlobCache);
    }

    // Patch contents[] (3D Tiles 1.1)
    if (Array.isArray(node.contents)) {
      for (const content of node.contents) {
        await this.patchUriObject(content, currentJsonPath, filesByPath, jsonBlobCache, fileBlobCache);
      }
    }

    // Patch implicit tiling subtree URIs
    const implicit = node.extensions?.["3DTILES_implicit_tiling"];
    if (implicit?.subtrees) {
      await this.patchUriObject(implicit.subtrees, currentJsonPath, filesByPath, jsonBlobCache, fileBlobCache);
    }
    if (node.implicitTiling?.subtrees) {
      await this.patchUriObject(node.implicitTiling.subtrees, currentJsonPath, filesByPath, jsonBlobCache, fileBlobCache);
    }

    // Recurse into children
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        await this.patchTilesetNode(child, currentJsonPath, filesByPath, jsonBlobCache, fileBlobCache);
      }
    }
  }

  private async buildPatchedJsonBlobUrl(
    jsonPath: string,
    filesByPath: Map<string, File>,
    jsonBlobCache: Map<string, string>,
    fileBlobCache: Map<string, string>,
  ): Promise<string | null> {
    const normalized = this.normalizePath(jsonPath);

    const cached = jsonBlobCache.get(normalized);
    if (cached) return cached;

    const file = filesByPath.get(normalized);
    if (!file) {
      console.warn("[CustomTiles] Missing JSON tileset:", normalized);
      return null;
    }

    const json = JSON.parse(await file.text());

    // Patch the root tile node inside this JSON
    if (json.root) {
      await this.patchTilesetNode(json.root, normalized, filesByPath, jsonBlobCache, fileBlobCache);
    }

    const blob = new Blob([JSON.stringify(json)], { type: "application/json" });
    const blobUrl = URL.createObjectURL(blob);
    jsonBlobCache.set(normalized, blobUrl);
    this.customTilesBlobUrls.push(blobUrl);
    return blobUrl;
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
    mapSource: "google" | "custom" | "osm",
    lat: number,
    lon: number,
    alt: number,
    heading: number,
    scale: number,
  ): void {
    if (!this.tilesRenderer) return;
    if (mapSource === "osm") return; // OSM doesn't use tilesRenderer transform

    if (mapSource === "google") {
      // Google tiles are natively ECEF — identity transform
      this.tilesRenderer.group.position.set(0, 0, 0);
      this.tilesRenderer.group.quaternion.identity();
      this.tilesRenderer.group.scale.set(1, 1, 1);
      return;
    }

    // Native-georef custom tiles behave like Google tiles (already ECEF)
    if (mapSource === "custom" && this._useNativeGeoref) {
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
    if (this.currentUrdfXml) {
      const xml = this.currentUrdfXml;
      // Force reload by clearing state
      this.currentUrdfXml = "";
      this.urdfLoaded = false;
      this.loadUrdf(xml);
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

    // 3. No local file match — return original URL (will fail gracefully)
    return url;
  }

  loadUrdf(urdfXml: string): void {
    // Skip if same URDF already loaded
    if (this.currentUrdfXml === urdfXml && this.urdfLoaded) return;
    this.currentUrdfXml = urdfXml;

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

    // Resolve package:// URLs — local files handle this via resolveUrl.
    // This is a fallback that returns a dummy path (mesh won't load but won't crash).
    loader.packages = (_packageName: string): string => {
      return "";
    };

    try {
      const robot = loader.parse(urdfXml);
      this.urdfRobot = robot;

      this.urdfGroup = new THREE.Group();
      this.urdfGroup.add(robot);
      this.localOriginGroup.add(this.urdfGroup);
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

    // Start ray from 10000m above the ellipsoid surface
    const origin = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, 10000, origin);

    // Ray downward — far enough to reach terrain at any realistic altitude
    const direction = up.clone().negate();

    this.raycaster.set(origin, direction);
    this.raycaster.far = 15000;
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
   * Update the localOriginGroup's position/orientation from the transformer anchor.
   * The group is placed at the anchor ECEF (first GPS fix) with ENU rotation.
   * All local geometry (robot, URDF, grid, waypoints, etc.) is positioned inside
   * using local ENU coords relative to the anchor, so as the robot moves in
   * local coords, it moves relative to the fixed tiles on the globe.
   */
  updateLocalOrigin(transformer: GlobeTransformer): void {
    if (!this.localOriginAdded) {
      this.scene.add(this.localOriginGroup);
      this.localOriginAdded = true;
    }
    const ecef = transformer.getAnchorEcefPosition();
    const enu = transformer.getAnchorEnuQuaternion();

    // The altitudeOffset shifts overlays up/down in local ENU (Z axis).
    // We apply it as an ECEF offset along the "up" direction at the anchor.
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(enu);
    this.localOriginGroup.position.copy(ecef).addScaledVector(up, transformer.altitudeOffset);
    this.localOriginGroup.quaternion.copy(enu);
    this.localOriginGroup.updateMatrixWorld(true);
  }

  /**
   * Position URDF using local coords from transformer.
   */
  positionUrdfViaTransformer(transformer: GlobeTransformer): void {
    if (!this.urdfGroup) return;

    // Always position URDF at base_link (where the robot physically is),
    // regardless of displayFrame setting. This matches RViz convention.
    // The group rotation (set in updateLocalOrigin) already accounts for the
    // fixed frame's orientation, so we just need the relative transform.
    const baseFrame = transformer.framePrefix + "base_link";
    const pos = transformer.transformToLocal(new THREE.Vector3(), baseFrame);
    if (!pos) return;

    const quat = transformer.transformOrientationToLocal(
      new THREE.Quaternion(0, 0, 0, 1), baseFrame,
    );
    if (!quat) return;

    this.urdfGroup.position.copy(pos);
    this.urdfGroup.quaternion.copy(quat);
    this.urdfGroup.updateMatrixWorld(true);
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
        const applyOpacity = (mat: THREE.Material) => {
          const m = mat as THREE.MeshStandardMaterial;
          m.transparent = opacity < 1;
          m.opacity = opacity;
          // Keep depthWrite true so the URDF renders self-consistently.
          // TF frame axes already use depthTest:false, so they show through.
        };
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(applyOpacity);
        } else if (mesh.material) {
          applyOpacity(mesh.material);
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
      this.localOriginGroup.remove(this.urdfGroup);
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
    showLabels = false,
  ): void {
    if (!this.tfVisualsAdded) {
      this.localOriginGroup.add(this.tfVisualGroup);
      this.tfVisualsAdded = true;
    }

    const tfSystem = transformer.tfSystem;
    const frameIds = tfSystem.getFrameIds();
    const activeFrames = new Set<string>();
    const framePositions = new Map<string, THREE.Vector3>();

    for (const frameId of frameIds) {
      const pos = transformer.transformToLocal(new THREE.Vector3(), frameId);
      if (!pos) continue;

      // Skip frames that are extremely far from the origin (> 50km)
      // These are likely UTM or global frames that create long visual lines
      if (pos.length() > 50000) continue;

      const orientQuat = transformer.transformOrientationToLocal(
        new THREE.Quaternion(0, 0, 0, 1), frameId,
      );
      if (!orientQuat) continue;

      activeFrames.add(frameId);
      framePositions.set(frameId, pos.clone());

      const axesScale = Math.max(0.5, tfSize);

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

      if (showLabels) {
        let label = this.tfLabelCache.get(frameId);
        if (!label) {
          label = this.createTextSprite(frameId);
          this.tfVisualGroup.add(label);
          this.tfLabelCache.set(frameId, label);
        }
        label.position.copy(pos).add(new THREE.Vector3(0, 0, axesScale * 1.1));
        const labelHeight = axesScale * 0.3;
        const aspect = (label as any)._aspect || 4;
        label.scale.set(labelHeight * aspect, labelHeight, 1);
        label.visible = true;
      }
    }

    // Draw yellow lines from each child to its parent (only if both visible)
    for (const frameId of activeFrames) {
      const parentId = tfSystem.getParentId(frameId);
      if (!parentId || !framePositions.has(parentId) || !framePositions.has(frameId)) {
        const line = this.tfLineCache.get(frameId);
        if (line) line.visible = false;
        continue;
      }

      const childPos = framePositions.get(frameId)!;
      const parentPos = framePositions.get(parentId)!;

      // Skip lines longer than 100m (likely a root→global connection)
      const dist = childPos.distanceTo(parentPos);
      if (dist > 100) {
        const line = this.tfLineCache.get(frameId);
        if (line) line.visible = false;
        continue;
      }

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

    // Hide visuals for frames no longer active
    for (const [id, axes] of this.tfAxesCache) {
      if (!activeFrames.has(id)) axes.visible = false;
    }
    for (const [id, line] of this.tfLineCache) {
      if (!activeFrames.has(id)) line.visible = false;
    }
    for (const [id, label] of this.tfLabelCache) {
      if (!activeFrames.has(id) || !showLabels) label.visible = false;
    }
  }

  private createTextSprite(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const fontSize = 48;
    ctx.font = `bold ${fontSize}px monospace`;
    const measured = ctx.measureText(text);
    const pad = 16;
    canvas.width = Math.ceil(measured.width + pad * 2);
    canvas.height = Math.ceil(fontSize * 1.4 + pad * 2);
    // Re-set font after resize (canvas resize clears state)
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    const r = 8;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1001;
    // Store aspect ratio for proper sizing
    (sprite as any)._aspect = canvas.width / canvas.height;
    return sprite;
  }

  setTfVisible(visible: boolean): void {
    this.tfVisualGroup.visible = visible;
  }

  /** Shift the entire TF visual group by Z offset (used in OSM mode). */
  offsetTfGroup(zOffset: number): void {
    this.tfVisualGroup.position.z = zOffset;
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
    for (const label of this.tfLabelCache.values()) {
      (label.material as THREE.SpriteMaterial).map?.dispose();
      (label.material as THREE.Material).dispose();
    }
    this.tfAxesCache.clear();
    this.tfLineCache.clear();
    this.tfLabelCache.clear();

    if (this.tfVisualsAdded) {
      this.localOriginGroup.remove(this.tfVisualGroup);
      this.tfVisualsAdded = false;
    }
    this.tfVisualGroup = new THREE.Group();
  }

  // ========== Robot Marker Methods ==========

  createRobotMarker(): void {
    if (this.robotMarker) return;
    const geometry = new THREE.SphereGeometry(0.15, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false,
    });
    this.robotMarker = new THREE.Mesh(geometry, material);
    this.robotMarker.renderOrder = 999;
    this.localOriginGroup.add(this.robotMarker);
  }

  updateRobotMarkerViaTransformer(transformer: GlobeTransformer): void {
    if (!this.robotMarker) this.createRobotMarker();
    if (!this.robotMarker) return;

    // Always track base_link regardless of displayFrame setting
    const baseFrame = transformer.framePrefix + "base_link";
    const target = transformer.transformToLocal(
      new THREE.Vector3(0, 0, 0.3), baseFrame,
    );
    if (!target) return;

    this.robotMarker.position.copy(target);
  }

  updateTrailViaTransformer(transformer: GlobeTransformer, maxPoints = 500): void {
    const baseFrame = transformer.framePrefix + "base_link";
    const point = transformer.transformToLocal(
      new THREE.Vector3(0, 0, 0.3), baseFrame,
    );
    if (!point) return;

    this.trailPositions.push(point.clone());
    while (this.trailPositions.length > maxPoints) this.trailPositions.shift();

    if (this.trailLine) {
      this.localOriginGroup.remove(this.trailLine);
      this.trailLine.geometry.dispose();
      (this.trailLine.material as THREE.Material).dispose();
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
      this.localOriginGroup.add(this.trailLine);
    }
  }

  clearTrail(): void {
    if (this.trailLine) {
      this.localOriginGroup.remove(this.trailLine);
      this.trailLine.geometry.dispose();
      this.trailLine = null;
    }
    this.trailPositions = [];
  }

  removeRobotMarker(): void {
    if (this.robotMarker) {
      this.localOriginGroup.remove(this.robotMarker);
      this.robotMarker.geometry.dispose();
      (this.robotMarker.material as THREE.Material).dispose();
      this.robotMarker = null;
    }
  }

  // ========== Grid Overlay Methods ==========

  updateGrid(
    show: boolean,
    sizeMeters: number,
    spacing: number,
    heightOffset: number,
    lineWidth: number,
  ): void {
    if (!show) {
      if (this.gridGroup) {
        this.gridGroup.visible = false;
      }
      return;
    }

    if (!this.gridGroup) {
      this.gridGroup = new THREE.Group();
      this.localOriginGroup.add(this.gridGroup);
      this.gridAdded = true;
    }

    // Build a cache key to detect when we need to rebuild
    const cacheKey = `${sizeMeters}_${spacing}_${heightOffset}_${lineWidth}`;
    const existingKey = (this.gridGroup as any)._gridKey;
    if (existingKey !== cacheKey) {
      // Dispose old grid resources before clearing
      this.gridGroup.traverse((child) => {
        if ((child as THREE.Line).isLine) {
          (child as THREE.Line).geometry?.dispose();
          ((child as THREE.Line).material as THREE.Material)?.dispose();
        }
      });
      this.gridGroup.clear();

      const halfSize = sizeMeters / 2;
      const step = Math.max(1, spacing);
      const z = heightOffset;
      const lines: THREE.Vector3[] = [];

      // Grid lines along X (East-West)
      for (let y = -halfSize; y <= halfSize; y += step) {
        lines.push(new THREE.Vector3(-halfSize, y, z));
        lines.push(new THREE.Vector3(halfSize, y, z));
      }
      // Grid lines along Y (North-South)
      for (let x = -halfSize; x <= halfSize; x += step) {
        lines.push(new THREE.Vector3(x, -halfSize, z));
        lines.push(new THREE.Vector3(x, halfSize, z));
      }

      const geom = new THREE.BufferGeometry().setFromPoints(lines);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        depthTest: true,
        linewidth: lineWidth,
      });
      const lineSegments = new THREE.LineSegments(geom, mat);
      this.gridGroup.add(lineSegments);

      (this.gridGroup as any)._gridKey = cacheKey;
    }

    this.gridGroup.visible = true;
  }

  // ========== Interactive Tool Methods ==========

  // Waypoint markers group
  private waypointGroup: THREE.Group = new THREE.Group();
  private waypointAdded = false;
  // Temporary arrow shown during drag to set heading
  private waypointDragArrow: THREE.Group | null = null;

  // Measurement state
  private measureGroup: THREE.Group = new THREE.Group();
  private measureAdded = false;

  /**
   * Raycast from screen coords (NDC) against the grid plane at the given Z height
   * in localOriginGroup local space. Returns the intersection point in local coords.
   */
  raycastGridPlane(ndcX: number, ndcY: number, gridHeightOffset: number): THREE.Vector3 | null {
    // Ensure camera matrices are current (pointer events fire between render frames)
    this.camera.updateMatrixWorld(true);
    const ndc = new THREE.Vector2(ndcX, ndcY);
    this.raycaster.setFromCamera(ndc, this.camera);

    const planeNormalLocal = new THREE.Vector3(0, 0, 1);
    const planePointLocal = new THREE.Vector3(0, 0, gridHeightOffset);

    const worldMatrix = this.localOriginGroup.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    const planeNormalWorld = planeNormalLocal.clone().applyMatrix3(normalMatrix).normalize();
    const planePointWorld = planePointLocal.clone().applyMatrix4(worldMatrix);

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormalWorld, planePointWorld);
    const intersection = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(plane, intersection);
    if (!hit) return null;

    const invWorld = new THREE.Matrix4().copy(worldMatrix).invert();
    return intersection.applyMatrix4(invWorld);
  }

  /**
   * Create a waypoint marker: small sphere + arrow indicating heading.
   * heading = radians from East (ENU X-axis), counter-clockwise positive.
   */
  addWaypointMarker(position: THREE.Vector3, heading: number, index: number): void {
    if (!this.waypointAdded) {
      this.localOriginGroup.add(this.waypointGroup);
      this.waypointAdded = true;
    }

    const group = new THREE.Group();
    (group as any)._waypointId = true;

    // Small sphere at the position
    const sphereGeom = new THREE.SphereGeometry(0.12, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    sphere.renderOrder = 1100;
    group.add(sphere);

    // Arrow: shaft (cylinder) + head (cone), pointing in heading direction
    const arrowGroup = new THREE.Group();

    // Shaft: length 0.6, radius 0.03
    const shaftGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6);
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0xff6666, depthTest: false });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.rotation.z = -Math.PI / 2; // orient along +X
    shaft.position.x = 0.3; // center of shaft
    shaft.renderOrder = 1100;
    arrowGroup.add(shaft);

    // Head: cone pointing in +X direction
    const headGeom = new THREE.ConeGeometry(0.08, 0.2, 6);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false });
    const head = new THREE.Mesh(headGeom, headMat);
    head.rotation.z = -Math.PI / 2; // orient tip along +X
    head.position.x = 0.7;
    head.renderOrder = 1100;
    arrowGroup.add(head);

    // Rotate arrow group by heading around Z axis
    arrowGroup.rotation.z = heading;
    group.add(arrowGroup);

    // Index label
    const label = this.createSmallLabel(`${index + 1}`, "#ff4444", "#000");
    label.position.z = 0.4;
    group.add(label);

    group.position.copy(position);
    this.waypointGroup.add(group);
  }

  /**
   * Show a temporary drag arrow from origin position during heading selection.
   */
  showDragArrow(origin: THREE.Vector3, heading: number): void {
    this.removeDragArrow();
    const arrowGroup = new THREE.Group();

    const shaftGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6);
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false, transparent: true, opacity: 0.7 });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.rotation.z = -Math.PI / 2;
    shaft.position.x = 0.4;
    shaft.renderOrder = 1102;
    arrowGroup.add(shaft);

    const headGeom = new THREE.ConeGeometry(0.1, 0.25, 6);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false, transparent: true, opacity: 0.7 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.rotation.z = -Math.PI / 2;
    head.position.x = 0.9;
    head.renderOrder = 1102;
    arrowGroup.add(head);

    arrowGroup.rotation.z = heading;
    arrowGroup.position.copy(origin);

    if (!this.waypointAdded) {
      this.localOriginGroup.add(this.waypointGroup);
      this.waypointAdded = true;
    }
    this.waypointGroup.add(arrowGroup);
    this.waypointDragArrow = arrowGroup;
  }

  removeDragArrow(): void {
    if (this.waypointDragArrow) {
      this.waypointDragArrow.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
          ((child as THREE.Mesh).material as THREE.Material)?.dispose();
        }
      });
      this.waypointGroup.remove(this.waypointDragArrow);
      this.waypointDragArrow = null;
    }
  }

  /**
   * Remove a specific waypoint marker by its index in the group.
   */
  removeWaypointAt(index: number): void {
    const markers = this.waypointGroup.children.filter((c) => (c as any)._waypointId);
    if (index >= 0 && index < markers.length) {
      const marker = markers[index]!;
      marker.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
          ((child as THREE.Mesh).material as THREE.Material)?.dispose();
        }
        if ((child as THREE.Sprite).isSprite) {
          ((child as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose();
          ((child as THREE.Sprite).material as THREE.Material).dispose();
        }
      });
      this.waypointGroup.remove(marker);
    }
  }

  clearWaypoints(): void {
    this.removeDragArrow();
    this.waypointGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry?.dispose();
        ((child as THREE.Mesh).material as THREE.Material)?.dispose();
      }
      if ((child as THREE.Sprite).isSprite) {
        ((child as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose();
        ((child as THREE.Sprite).material as THREE.Material).dispose();
      }
    });
    this.waypointGroup.clear();
  }

  /**
   * Rebuild all waypoint markers from data (used after reorder/delete).
   */
  rebuildWaypointMarkers(waypoints: Array<{ x: number; y: number; z: number; heading: number }>): void {
    this.clearWaypoints();
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i]!;
      this.addWaypointMarker(new THREE.Vector3(wp.x, wp.y, wp.z), wp.heading, i);
    }
  }

  addMeasurePoint(position: THREE.Vector3): number {
    if (!this.measureAdded) {
      this.localOriginGroup.add(this.measureGroup);
      this.measureAdded = true;
    }

    // Count only pending (non-completed) points for current measurement pair
    const pendingPoints = this.measureGroup.children.filter(
      (c) => (c as any)._isMeasurePoint && !(c as any)._completed,
    );

    // Small endpoint sphere
    const sphereGeom = new THREE.SphereGeometry(0.08, 10, 10);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    sphere.position.copy(position);
    sphere.renderOrder = 1100;
    (sphere as any)._isMeasurePoint = true;
    (sphere as any)._measurePosition = position.clone();
    this.measureGroup.add(sphere);

    const newPendingCount = pendingPoints.length + 1;

    if (newPendingCount === 2) {
      // Complete this measurement pair — draw line and label
      const points = [...pendingPoints, sphere]
        .map((c) => (c as any)._measurePosition as THREE.Vector3);

      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        depthTest: false,
        linewidth: 2,
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.renderOrder = 1099;
      this.measureGroup.add(line);

      const dist = points[0]!.distanceTo(points[1]!);
      const midpoint = new THREE.Vector3().addVectors(points[0]!, points[1]!).multiplyScalar(0.5);
      const label = this.createMeasureLabel(`${dist.toFixed(2)} m`);
      label.position.copy(midpoint);
      label.position.z += 0.5;
      this.measureGroup.add(label);

      // Mark endpoints as completed so next click starts a new pair
      pendingPoints.forEach((p) => { (p as any)._completed = true; });
      (sphere as any)._completed = true;
    }

    return newPendingCount;
  }

  clearMeasurement(): void {
    this.measureGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.Line).isLine) {
        (child as any).geometry?.dispose();
        ((child as any).material as THREE.Material)?.dispose();
      }
      if ((child as THREE.Sprite).isSprite) {
        ((child as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose();
        ((child as THREE.Sprite).material as THREE.Material).dispose();
      }
    });
    this.measureGroup.clear();
  }

  private createMeasureLabel(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 192;
    canvas.height = 48;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.roundRect(0, 0, canvas.width, canvas.height, 6);
    ctx.fill();
    ctx.fillStyle = "#00ffff";
    ctx.font = "bold 24px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.4, 1);
    sprite.renderOrder = 1101;
    return sprite;
  }

  private createSmallLabel(text: string, color: string, bg: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    canvas.width = 64;
    canvas.height = 64;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 34);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.35, 0.35, 1);
    sprite.renderOrder = 1101;
    return sprite;
  }

  // ========== Camera Methods ==========

  /**
   * Follow mode: translate camera so it tracks the robot.
   * Accepts local-frame coords; converts delta to ECEF via the localOriginGroup transform.
   */
  followRobotLocal(prevLocal: THREE.Vector3, newLocal: THREE.Vector3): void {
    const deltaLocal = new THREE.Vector3().subVectors(newLocal, prevLocal);
    const deltaEcef = deltaLocal.clone().applyQuaternion(this.localOriginGroup.quaternion);
    this.camera.position.add(deltaEcef);
    this.camera.updateMatrixWorld();
  }

  /**
   * Initial camera placement: set view looking at robot from ~45° angle.
   * Uses ground raycast to find actual surface height, so we don't clip underground.
   */
  setInitialView(lat: number, lon: number, gpsAlt?: number): void {
    const latRad = lat * DEG2RAD;
    const lonRad = lon * DEG2RAD;

    // Get surface normal, east, north at this location
    const up = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);
    const north = new THREE.Vector3(0, 0, 1);
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    if (east.lengthSq() < 0.001) east.set(1, 0, 0);
    const correctedNorth = new THREE.Vector3().crossVectors(up, east).normalize();

    // Try to find actual ground height via raycast against loaded tiles
    const groundEcef = this.getGroundPosition(lat, lon);
    let targetPos: THREE.Vector3;
    if (groundEcef) {
      targetPos = groundEcef.clone();
    } else {
      // Fallback: use GPS altitude (which IS the robot's real height above ellipsoid)
      // Altitude 0 would be underground when terrain is above sea level.
      const fallbackAlt = gpsAlt ?? 0;
      targetPos = new THREE.Vector3();
      WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, fallbackAlt, targetPos);
    }

    // Place camera ~45° looking at the target from the south.
    // 40m above ground + 40m to the south → ~45° viewing angle.
    const cameraPos = new THREE.Vector3()
      .copy(targetPos)
      .addScaledVector(up, 40)
      .addScaledVector(correctedNorth, -40);

    this.camera.position.copy(cameraPos);
    this.camera.up.copy(up);
    this.camera.lookAt(targetPos);
    this.camera.updateMatrixWorld();
  }

  /**
   * Reset camera to look at the robot from above (re-usable after panning away).
   */
  resetCameraToRobot(lat: number, lon: number, gpsAlt?: number): void {
    this.setInitialView(lat, lon, gpsAlt);
  }

  /**
   * Center OSM camera on a local ENU position.
   * Places camera above + slightly south at ~45° angle (like 3D initial view).
   */
  centerOSMCamera(x: number, y: number): void {
    // Keep current distance or default to 60
    const currentDist = this.camera.position.distanceTo(
      this.mapControls?.target ?? new THREE.Vector3(x, y, 0)
    );
    const dist = Math.max(currentDist, 20);
    const halfDist = dist * 0.707; // ~45° angle

    this.camera.up.set(0, 0, 1);
    this.camera.position.set(x, y - halfDist, halfDist);
    this.camera.lookAt(x, y, 0);
    if (this.mapControls) {
      this.mapControls.target.set(x, y, 0);
      this.mapControls.update(0);
    }
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
      if (this.mapControls) this.mapControls.update(delta);
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
    this.disposeOSM();
    this.revokeCustomBlobUrls();
    this.removeRobotMarker();
    this.clearTrail();
    this.removeUrdf();
    this.removeTfVisualization();
    this.clearWaypoints();
    this.clearMeasurement();

    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
