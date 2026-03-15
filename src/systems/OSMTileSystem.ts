import * as THREE from "three";

// ==================== OSM TILE SYSTEM ====================
// Loads OpenStreetMap raster tiles as textured planes in local ENU coordinates.
// Tiles follow the Slippy Map convention: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
//
// The system maintains a visible grid of tiles centered on the current camera/robot position.
// Tiles are loaded/unloaded dynamically as the viewport moves.

const TILE_SIZE_PX = 256; // OSM tiles are 256x256
const EARTH_CIRCUMFERENCE = 40075016.686; // meters at equator
const TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_RADIUS = 3; // load (2*R+1)^2 grid centered on camera

export class OSMTileSystem {
  private group = new THREE.Group();
  private tiles = new Map<string, THREE.Mesh>(); // key: "z/x/y"
  private loading = new Set<string>();
  private textureLoader = new THREE.TextureLoader();

  // Anchor GPS (set once on first GPS fix)
  private anchorLat = 0;
  private anchorLon = 0;
  private anchored = false;

  // Current zoom level
  private zoom = 18;

  // Track last tile center to avoid recomputing every frame
  private lastCenterTileX = -1;
  private lastCenterTileY = -1;
  private lastZoom = -1;

  constructor() {
    this.group.name = "OSMTiles";
    // Set cross-origin for tile loading
    this.textureLoader.crossOrigin = "anonymous";
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  setAnchor(lat: number, lon: number): void {
    if (this.anchored) return;
    this.anchorLat = lat;
    this.anchorLon = lon;
    this.anchored = true;
    console.log(`[OSM] Anchor set: (${lat.toFixed(7)}, ${lon.toFixed(7)})`);
  }

  isAnchored(): boolean {
    return this.anchored;
  }

  resetAnchor(): void {
    this.anchored = false;
    this.disposeAll();
    this.lastCenterTileX = -1;
    this.lastCenterTileY = -1;
    this.lastZoom = -1;
  }

  setZoom(zoom: number): void {
    zoom = Math.max(1, Math.min(19, Math.round(zoom)));
    if (zoom !== this.zoom) {
      this.zoom = zoom;
      // Force full reload on zoom change
      this.lastCenterTileX = -1;
      this.lastCenterTileY = -1;
      this.lastZoom = -1;
    }
  }

  // ==================== CORE UPDATE ====================
  // Called every frame (or on camera move). `centerENU` is the point in local ENU
  // coords that should be at the center of the visible tile grid.
  // Typically this is (0, 0, 0) — the robot/anchor position.
  update(centerENU: THREE.Vector3 | null): void {
    if (!this.anchored) return;

    // Convert center ENU back to lat/lon
    const centerLat = centerENU
      ? this.anchorLat + (centerENU.y / EARTH_CIRCUMFERENCE) * 360
      : this.anchorLat;
    const centerLon = centerENU
      ? this.anchorLon + (centerENU.x / (EARTH_CIRCUMFERENCE * Math.cos(this.anchorLat * Math.PI / 180))) * 360
      : this.anchorLon;

    const z = this.zoom;
    const cx = this.lonToTileX(centerLon, z);
    const cy = this.latToTileY(centerLat, z);

    // Check if center tile changed (used for disposal, but always try loading more)
    const centerChanged = cx !== this.lastCenterTileX || cy !== this.lastCenterTileY || z !== this.lastZoom;
    this.lastCenterTileX = cx;
    this.lastCenterTileY = cy;
    this.lastZoom = z;

    // Determine which tiles should be visible
    const maxTile = (1 << z) - 1;
    const neededKeys = new Set<string>();
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
      for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || tx > maxTile || ty < 0 || ty > maxTile) continue;
        neededKeys.add(`${z}/${tx}/${ty}`);
      }
    }

    // Remove tiles that are no longer needed (only when center changed)
    if (centerChanged) {
      for (const [key, mesh] of this.tiles) {
        if (!neededKeys.has(key)) {
          this.group.remove(mesh);
          mesh.geometry.dispose();
          const mat = mesh.material as THREE.MeshBasicMaterial;
          if (mat.map) mat.map.dispose();
          mat.dispose();
          this.tiles.delete(key);
        }
      }
    }

    // Load tiles that are needed but not yet loaded (always try, no concurrency cap)
    for (const key of neededKeys) {
      if (this.tiles.has(key) || this.loading.has(key)) continue;
      this.loadTile(key);
    }
  }

  // ==================== TILE LOADING ====================
  private loadTile(key: string): void {
    this.loading.add(key);
    const [zStr, xStr, yStr] = key.split("/");
    const z = parseInt(zStr!, 10);
    const x = parseInt(xStr!, 10);
    const y = parseInt(yStr!, 10);

    const url = TILE_URL_TEMPLATE
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));

    this.textureLoader.load(
      url,
      (texture) => {
        this.loading.delete(key);
        if (this.tiles.has(key)) return; // already loaded by another path

        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.colorSpace = THREE.SRGBColorSpace;

        // Compute tile size in meters
        const tileMeters = this.tileSizeMeters(z);
        const geom = new THREE.PlaneGeometry(tileMeters, tileMeters);

        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false,
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.renderOrder = 0;

        // Position tile in local ENU
        const pos = this.tileToENU(x, y, z);
        mesh.position.set(pos.x, pos.y, 0); // Z=0 ground plane (grid at 0.01 renders above)

        // PlaneGeometry faces +Z by default, which is "up" in ENU — perfect for a flat map
        this.group.add(mesh);
        this.tiles.set(key, mesh);
      },
      undefined,
      () => {
        // Load error — just remove from loading set
        this.loading.delete(key);
      },
    );
  }

  // ==================== COORDINATE MATH ====================

  // Convert longitude to tile X at zoom level
  private lonToTileX(lon: number, z: number): number {
    return Math.floor(((lon + 180) / 360) * (1 << z));
  }

  // Convert latitude to tile Y at zoom level
  private latToTileY(lat: number, z: number): number {
    const latRad = lat * (Math.PI / 180);
    return Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * (1 << z),
    );
  }

  // Convert tile X to longitude (NW corner of tile)
  private tileXToLon(x: number, z: number): number {
    return (x / (1 << z)) * 360 - 180;
  }

  // Convert tile Y to latitude (NW corner of tile)
  private tileYToLat(y: number, z: number): number {
    const n = Math.PI - (2 * Math.PI * y) / (1 << z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  // Size of one tile in meters at given zoom
  private tileSizeMeters(z: number): number {
    // At the anchor latitude
    const cosLat = Math.cos(this.anchorLat * (Math.PI / 180));
    return (EARTH_CIRCUMFERENCE * cosLat) / (1 << z);
  }

  // Convert tile (x, y) center to local ENU meters relative to anchor
  private tileToENU(x: number, y: number, z: number): { x: number; y: number } {
    // Get lat/lon of tile center
    const tileLonNW = this.tileXToLon(x, z);
    const tileLatNW = this.tileYToLat(y, z);
    const tileLonSE = this.tileXToLon(x + 1, z);
    const tileLatSE = this.tileYToLat(y + 1, z);

    const tileCenterLon = (tileLonNW + tileLonSE) / 2;
    const tileCenterLat = (tileLatNW + tileLatSE) / 2;

    // Convert to ENU offset from anchor
    const cosLat = Math.cos(this.anchorLat * (Math.PI / 180));
    const metersPerDegLon = (EARTH_CIRCUMFERENCE * cosLat) / 360;
    const metersPerDegLat = EARTH_CIRCUMFERENCE / 360;

    const eastMeters = (tileCenterLon - this.anchorLon) * metersPerDegLon;
    const northMeters = (tileCenterLat - this.anchorLat) * metersPerDegLat;

    return { x: eastMeters, y: northMeters };
  }

  // ==================== CLEANUP ====================
  disposeAll(): void {
    for (const [, mesh] of this.tiles) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.tiles.clear();
    this.loading.clear();
  }

  dispose(): void {
    this.disposeAll();
    this.group.clear();
  }
}
