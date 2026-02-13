import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType, LayerConfig } from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";
import { MapLayer } from "./MapLayer";

// ==================== ODOMETRY LAYER ====================

export class OdometryLayer implements MapLayer {
  readonly id: string;
  readonly type: LayerType = "odometry";
  topic: string;
  private color: string;
  private opacity: number;
  private group = new THREE.Group();
  private arrowGroup: THREE.Group | null = null;
  private cachedPose: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  } | null = null;
  private cachedFrameId = "";

  // Dirty flag: only rebuild when new odometry data arrives
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
      const odom = msg.message as any;
      const pose = odom?.pose?.pose ?? odom?.pose;
      if (!pose?.position) continue;
      this.cachedFrameId = odom.header?.frame_id || "";
      this.cachedPose = {
        position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
        orientation: {
          x: pose.orientation?.x ?? 0,
          y: pose.orientation?.y ?? 0,
          z: pose.orientation?.z ?? 0,
          w: pose.orientation?.w ?? 1,
        },
      };
      this.dirty = true;
    }
  }

  updateVisualization(transformer: GlobeTransformer): void {
    if (!this.dirty || !this.cachedPose) return;
    this.dirty = false;

    const frameId = this.cachedFrameId || transformer.fixedFrame;
    const pos = new THREE.Vector3(
      this.cachedPose.position.x,
      this.cachedPose.position.y,
      this.cachedPose.position.z,
    );
    const globePos = transformer.transformToGlobe(pos, frameId);
    if (!globePos) {
      if (this.arrowGroup) this.arrowGroup.visible = false;
      return;
    }

    const inputQuat = new THREE.Quaternion(
      this.cachedPose.orientation.x,
      this.cachedPose.orientation.y,
      this.cachedPose.orientation.z,
      this.cachedPose.orientation.w,
    );
    const globeQuat = transformer.transformOrientationToGlobe(inputQuat, frameId);

    // Remove old arrow
    this.disposeArrow();

    // Build arrow from shaft (Line) + cone (Mesh)
    const dir = new THREE.Vector3(1, 0, 0);
    if (globeQuat) dir.applyQuaternion(globeQuat);

    const arrow = new THREE.ArrowHelper(dir, globePos, 2.0, new THREE.Color(this.color).getHex(), 0.6, 0.3);
    arrow.renderOrder = 900;
    arrow.traverse((child: THREE.Object3D) => {
      if ((child as any).material) {
        const mat = (child as any).material as THREE.Material;
        mat.transparent = this.opacity < 1;
        mat.opacity = this.opacity;
        mat.depthTest = false;
      }
    });
    this.arrowGroup = new THREE.Group();
    this.arrowGroup.add(arrow);
    this.group.add(this.arrowGroup);
  }

  private disposeArrow(): void {
    if (!this.arrowGroup) return;
    this.arrowGroup.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).geometry?.dispose();
        const m = (child as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
        else if (m) (m as THREE.Material).dispose();
      }
      if ((child as THREE.Line).isLine) {
        (child as THREE.Line).geometry?.dispose();
        const m = (child as THREE.Line).material;
        if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
        else if (m) (m as THREE.Material).dispose();
      }
    });
    this.group.remove(this.arrowGroup);
    this.arrowGroup = null;
  }

  setVisible(v: boolean): void { this.group.visible = v; }
  setColor(c: string): void {
    this.color = c;
    this.arrowGroup?.traverse((child: THREE.Object3D) => {
      if ((child as any).material) {
        ((child as any).material as THREE.MeshBasicMaterial).color?.set(c);
      }
    });
  }
  setOpacity(o: number): void { this.opacity = o; }
  getGroup(): THREE.Group { return this.group; }
  dispose(): void {
    this.disposeArrow();
    this.group.clear();
  }
}
