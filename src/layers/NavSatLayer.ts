import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType, LayerConfig } from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";
import { DEG2RAD } from "../constants";
import { MapLayer } from "./MapLayer";

// ==================== NAVSAT LAYER ====================
// Uses gpsToLocal() for local-ENU coords → full Float32 precision.

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
  private positionToleranceMeters = 0.0;
  private showLine = true;

  constructor(config: LayerConfig) {
    this.id = config.id;
    this.topic = config.topic;
    this.color = config.color;
    this.opacity = config.opacity;
    this.buffer = config.buffer || 1000;
    this.group.visible = config.visible;
    this.showLine = config.showLine !== false;
  }

  setBuffer(b: number): void {
    this.buffer = b;
    if (this.cachedPositions.length > b) {
      this.cachedPositions = this.cachedPositions.slice(-b);
      this.dirty = true;
    }
  }

  setPositionTolerance(tol: number): void {
    this.positionToleranceMeters = Math.max(0, tol);
  }

  setShowLine(show: boolean): void {
    this.showLine = show;
    if (this.line) this.line.visible = show;
  }

  processMessages(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      if (msg.topic !== this.topic) continue;
      const fix = msg.message as any;
      const lat = fix?.latitude;
      const lon = fix?.longitude;
      const alt = fix?.altitude ?? 0;
      if (lat == null || lon == null) continue;
      if (fix.status?.status === -1) continue;

      if (this.positionToleranceMeters > 0 && this.cachedPositions.length > 0) {
        const last = this.cachedPositions[this.cachedPositions.length - 1]!;
        const dLat = (lat - last.lat) * DEG2RAD;
        const dLon = (lon - last.lon) * DEG2RAD;
        const meanLat = ((lat + last.lat) * 0.5) * DEG2RAD;
        const R = 6378137.0;
        const dx = R * dLon * Math.cos(meanLat);
        const dy = R * dLat;
        const dz = alt - last.alt;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < this.positionToleranceMeters) {
          continue;
        }
      }

      this.cachedPositions.push({ lat, lon, alt });
      while (this.cachedPositions.length > this.buffer) {
        this.cachedPositions.shift();
      }
      this.dirty = true;
    }
  }

  updateVisualization(transformer: GlobeTransformer): void {
    if (!this.dirty) return;
    this.dirty = false;

    if (this.cachedPositions.length === 0) return;

    // Convert GPS → local ENU coords (small numbers, full precision)
    const localPoints: THREE.Vector3[] = [];
    for (const pos of this.cachedPositions) {
      const local = transformer.gpsToLocal(pos.lat, pos.lon, pos.alt);
      localPoints.push(local);
    }

    // Dispose old geometry
    if (this.points) {
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.group.remove(this.points);
    }
    if (this.line) {
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.group.remove(this.line);
    }

    if (localPoints.length >= 2) {
      const lineGeom = new THREE.BufferGeometry().setFromPoints(localPoints);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(this.color),
        linewidth: 2,
        depthTest: false,
        transparent: this.opacity < 1,
        opacity: this.opacity * 0.6,
      });
      this.line = new THREE.Line(lineGeom, lineMat);
      this.line.renderOrder = 899;
      this.line.visible = this.showLine;
      this.group.add(this.line);
    }

    const dotGeom = new THREE.BufferGeometry().setFromPoints(localPoints);
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
