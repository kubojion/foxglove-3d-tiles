import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType, LayerConfig } from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";
import { WGS84_ELLIPSOID, DEG2RAD } from "../constants";
import { MapLayer } from "./MapLayer";

// ==================== NAVSAT LAYER ====================

export class NavSatLayer implements MapLayer {
  readonly id: string;
  readonly type: LayerType = "navsat";
  topic: string;
  private color: string;
  private opacity: number;
  private buffer: number;
  private group = new THREE.Group();
  private points: THREE.Points | null = null;
  private line: THREE.Line | null = null;
  private cachedPositions: Array<{ lat: number; lon: number; alt: number }> = [];
  private dirty = false;

  constructor(config: LayerConfig) {
    this.id = config.id;
    this.topic = config.topic;
    this.color = config.color;
    this.opacity = config.opacity;
    this.buffer = config.buffer || 1000;
    this.group.visible = config.visible;
  }

  setBuffer(b: number): void {
    this.buffer = b;
    // Trim if current data exceeds new buffer
    if (this.cachedPositions.length > b) {
      this.cachedPositions = this.cachedPositions.slice(-b);
      this.dirty = true;
    }
  }

  processMessages(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      if (msg.topic !== this.topic) continue;
      const fix = msg.message as any;
      const lat = fix?.latitude;
      const lon = fix?.longitude;
      const alt = fix?.altitude ?? 0;
      if (lat == null || lon == null) continue;
      // Skip invalid fixes (status = -1 means no fix)
      if (fix.status?.status === -1) continue;
      this.cachedPositions.push({ lat, lon, alt });
      // Enforce buffer limit
      while (this.cachedPositions.length > this.buffer) {
        this.cachedPositions.shift();
      }
      this.dirty = true;
    }
  }

  updateVisualization(_transformer: GlobeTransformer): void {
    if (!this.dirty) return;
    this.dirty = false;

    if (this.cachedPositions.length === 0) return;

    // Convert GPS positions directly to ECEF (no TF needed)
    const ecefPoints: THREE.Vector3[] = [];
    for (const pos of this.cachedPositions) {
      const latRad = pos.lat * DEG2RAD;
      const lonRad = pos.lon * DEG2RAD;
      const ecef = new THREE.Vector3();

      // Try ground raycast for altitude clamping
      const groundPos = _transformer.getGroundPosition?.(pos.lat, pos.lon);
      if (groundPos) {
        const up = new THREE.Vector3();
        WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);
        ecef.copy(groundPos).addScaledVector(up, _transformer.altitudeOffset + 0.3);
      } else {
        WGS84_ELLIPSOID.getCartographicToPosition(
          latRad, lonRad, pos.alt + _transformer.altitudeOffset + 0.3, ecef,
        );
      }
      ecefPoints.push(ecef);
    }

    // Dispose old geometry
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.group.remove(this.points);
    }
    // if (this.line) {
    //   this.line.geometry.dispose();
    //   (this.line.material as THREE.Material).dispose();
    //   this.group.remove(this.line);
    // }

    // // Draw line connecting points
    // if (ecefPoints.length >= 2) {
    //   const lineGeom = new THREE.BufferGeometry().setFromPoints(ecefPoints);
    //   const lineMat = new THREE.LineBasicMaterial({
    //     color: new THREE.Color(this.color),
    //     linewidth: 2,
    //     depthTest: false,
    //     transparent: this.opacity < 1,
    //     opacity: this.opacity * 0.6,
    //   });
    //   this.line = new THREE.Line(lineGeom, lineMat);
    //   this.line.renderOrder = 899;
    //   this.group.add(this.line);
    // }

    // Draw dots at each point
    const dotGeom = new THREE.BufferGeometry().setFromPoints(ecefPoints);
    const dotMat = new THREE.PointsMaterial({
      color: new THREE.Color(this.color),
      size: 4,
      sizeAttenuation: false,
      depthTest: false,
      transparent: this.opacity < 1,
      opacity: this.opacity,
    });
    this.points = new THREE.Points(dotGeom, dotMat);
    this.points.renderOrder = 900;
    this.group.add(this.points);
  }

  setVisible(v: boolean): void { this.group.visible = v; }
  setColor(c: string): void {
    this.color = c;
    if (this.points) (this.points.material as THREE.PointsMaterial).color.set(c);
    if (this.line) (this.line.material as THREE.LineBasicMaterial).color.set(c);
  }
  setOpacity(o: number): void {
    this.opacity = o;
    if (this.points) {
      const m = this.points.material as THREE.PointsMaterial;
      m.transparent = o < 1;
      m.opacity = o;
    }
    if (this.line) {
      const m = this.line.material as THREE.LineBasicMaterial;
      m.transparent = o < 1;
      m.opacity = o * 0.6;
    }
  }
  getGroup(): THREE.Group { return this.group; }
  dispose(): void {
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
    }
    if (this.line) {
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
