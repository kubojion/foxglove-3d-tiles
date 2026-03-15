import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType, LayerConfig } from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";
import { MapLayer } from "./MapLayer";

// ==================== OCCUPANCY GRID / COSTMAP LAYER ====================
// Renders nav_msgs/OccupancyGrid as a textured plane in local coords.
// Cell values: -1 = unknown (gray), 0 = free (transparent), 1-100 = occupied (color gradient)

export class OccupancyGridLayer implements MapLayer {
  readonly id: string;
  readonly type: LayerType = "costmap";
  topic: string;
  private color: string;
  private opacity: number;
  private group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private texture: THREE.DataTexture | null = null;
  private dirty = false;

  // Cached grid data
  private gridData: {
    width: number;
    height: number;
    resolution: number;
    origin: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    frameId: string;
    data: Uint8Array;
  } | null = null;

  constructor(config: LayerConfig) {
    this.id = config.id;
    this.topic = config.topic;
    this.color = config.color;
    this.opacity = config.opacity;
    this.group.visible = config.visible;
  }

  processMessages(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      if (msg.topic !== this.topic) continue;
      const grid = msg.message as any;
      if (!grid?.info || !grid?.data) continue;

      const info = grid.info;
      const width = info.width;
      const height = info.height;
      if (!width || !height) continue;

      const origin = info.origin?.position ?? { x: 0, y: 0, z: 0 };
      const orientation = info.origin?.orientation ?? { x: 0, y: 0, z: 0, w: 1 };

      // grid.data may be a regular Array or typed array
      // Use Uint8Array so we can handle both OccupancyGrid (-1→255, 0-100)
      // and raw costmap (0-255) uniformly.
      let rawData: Uint8Array;
      if (grid.data instanceof Uint8Array) {
        rawData = grid.data;
      } else if (ArrayBuffer.isView(grid.data)) {
        rawData = new Uint8Array((grid.data as any).buffer, (grid.data as any).byteOffset, (grid.data as any).byteLength);
      } else if (Array.isArray(grid.data)) {
        rawData = new Uint8Array(grid.data);
      } else {
        continue;
      }

      this.gridData = {
        width,
        height,
        resolution: info.resolution || 0.05,
        origin: { x: origin.x, y: origin.y, z: origin.z },
        orientation: {
          x: orientation.x ?? 0,
          y: orientation.y ?? 0,
          z: orientation.z ?? 0,
          w: orientation.w ?? 1,
        },
        frameId: grid.header?.frame_id || "",
        data: rawData,
      };
      this.dirty = true;
    }
  }

  updateVisualization(transformer: GlobeTransformer): void {
    if (!this.dirty || !this.gridData) return;
    this.dirty = false;

    const { width, height, resolution, origin, orientation, frameId, data } = this.gridData;

    // Create RGBA texture from occupancy data
    // Values are unsigned bytes: 0 = free, 1-100 (or 1-252) = cost, 255 = unknown (-1 signed)
    // nav2 costmap_2d: 253 = inscribed, 254 = lethal, 255 = no_info
    const rgba = new Uint8Array(width * height * 4);
    const layerColor = new THREE.Color(this.color);
    const r = Math.round(layerColor.r * 255);
    const g = Math.round(layerColor.g * 255);
    const b = Math.round(layerColor.b * 255);

    let nonZeroCount = 0;

    for (let i = 0; i < width * height; i++) {
      const val = data[i]!;
      const pixIdx = i * 4;

      if (val === 255) {
        // Unknown / no information (-1 in signed): dark gray, semi-transparent
        rgba[pixIdx] = 80;
        rgba[pixIdx + 1] = 80;
        rgba[pixIdx + 2] = 80;
        rgba[pixIdx + 3] = 100;
        nonZeroCount++;
      } else if (val === 0) {
        // Free: fully transparent
        rgba[pixIdx] = 0;
        rgba[pixIdx + 1] = 0;
        rgba[pixIdx + 2] = 0;
        rgba[pixIdx + 3] = 0;
      } else {
        // Occupied / cost (1-254): layer color, alpha proportional to cost
        // For standard OccupancyGrid (1-100), cost = val/100
        // For raw costmap (1-254), cost = val/254
        const cost = val <= 100 ? val / 100 : val / 254;
        rgba[pixIdx] = r;
        rgba[pixIdx + 1] = g;
        rgba[pixIdx + 2] = b;
        rgba[pixIdx + 3] = Math.round(Math.max(cost, 0.15) * 255);
        nonZeroCount++;
      }
    }

    // Transform origin to local coords
    const originPos = new THREE.Vector3(origin.x, origin.y, origin.z);
    const frame = frameId || transformer.fixedFrame;
    const localPos = transformer.transformToLocal(originPos, frame);
    if (!localPos) {
      console.warn(`[CostmapLayer] transformToLocal returned null for frame "${frame}" (fixed=${transformer.fixedFrame})`);
      return;
    }
    const originQuat = new THREE.Quaternion(
      orientation.x, orientation.y, orientation.z, orientation.w,
    );
    const localQuat = transformer.transformOrientationToLocal(originQuat, frame);

    // Dispose old resources
    this.disposeMesh();

    // Create texture
    this.texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat);
    this.texture.needsUpdate = true;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;

    // Create plane geometry — OccupancyGrid spans width*resolution x height*resolution
    const gridW = width * resolution;
    const gridH = height * resolution;
    const geom = new THREE.PlaneGeometry(gridW, gridH);

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: this.opacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.renderOrder = 850;

    // Position: origin is at bottom-left corner of the grid.
    // PlaneGeometry is centered, so offset by half the grid size.
    this.mesh.position.set(
      localPos.x + gridW / 2,
      localPos.y + gridH / 2,
      localPos.z + 0.02, // slight Z offset to avoid z-fighting
    );

    // Apply orientation (grid is in XY plane, PlaneGeometry faces +Z which is correct for ENU)
    if (localQuat) {
      this.mesh.quaternion.copy(localQuat);
    }

    this.group.add(this.mesh);
  }

  private disposeMesh(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
  }

  setVisible(v: boolean): void { this.group.visible = v; }
  setColor(c: string): void {
    this.color = c;
    // Mark dirty to rebuild texture with new color on next visualization update
    if (this.gridData) this.dirty = true;
  }
  setOpacity(o: number): void {
    this.opacity = o;
    if (this.mesh) {
      const m = this.mesh.material as THREE.MeshBasicMaterial;
      m.transparent = true;
      m.opacity = o;
    }
  }
  getGroup(): THREE.Group { return this.group; }
  dispose(): void {
    this.disposeMesh();
    this.group.clear();
  }
}
