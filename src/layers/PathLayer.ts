import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType, LayerConfig } from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";
import { MapLayer } from "./MapLayer";

// ==================== PATH LAYER ====================

export class PathLayer implements MapLayer {
  readonly id: string;
  readonly type: LayerType = "path";
  topic: string;
  private color: string;
  private opacity: number;
  private group = new THREE.Group();
  private line: THREE.Line | null = null;
  private cachedPoses: Array<{ x: number; y: number; z: number }> = [];
  private cachedFrameId = "";
  // Dirty flag: only rebuild geometry when new path data arrives
  private dirty = false;

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
      const pathMsg = msg.message as any;
      if (!pathMsg?.poses) continue;
      this.cachedFrameId = pathMsg.header?.frame_id || "";
      this.cachedPoses = pathMsg.poses.map((ps: any) => {
        const p = ps.pose?.position ?? ps.position ?? { x: 0, y: 0, z: 0 };
        return { x: p.x, y: p.y, z: p.z };
      });
      this.dirty = true; // Mark for rebuild
    }
  }

  updateVisualization(transformer: GlobeTransformer): void {
    // Always re-render if we have poses — the transformer state (TF, anchor)
    // may have changed even without new path data. Path data is typically small,
    // so the overhead is negligible.
    this.dirty = false;

    if (this.cachedPoses.length === 0) return;

    const frameId = this.cachedFrameId || transformer.fixedFrame;
    const points: THREE.Vector3[] = [];
    for (const p of this.cachedPoses) {
      const globe = transformer.transformToGlobe(
        new THREE.Vector3(p.x, p.y, p.z + 0.2), frameId,
      );
      if (globe) points.push(globe);
    }

    if (points.length < 2) return;

    // Reuse existing line if possible, just update geometry
    if (this.line) {
      this.line.geometry.dispose();
      this.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    } else {
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(this.color),
        linewidth: 2,
        depthTest: false,
        transparent: this.opacity < 1,
        opacity: this.opacity,
      });
      this.line = new THREE.Line(geom, mat);
      this.line.renderOrder = 900;
      this.group.add(this.line);
    }
  }

  setVisible(v: boolean): void { this.group.visible = v; }
  setColor(c: string): void {
    this.color = c;
    if (this.line) (this.line.material as THREE.LineBasicMaterial).color.set(c);
  }
  setOpacity(o: number): void {
    this.opacity = o;
    if (this.line) {
      const m = this.line.material as THREE.LineBasicMaterial;
      m.transparent = o < 1;
      m.opacity = o;
    }
  }
  getGroup(): THREE.Group { return this.group; }
  dispose(): void {
    if (this.line) {
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
