import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType, LayerConfig, MarkerMessage, MarkerArrayMessage } from "../types";
import {
  MARKER_ARROW, MARKER_CUBE, MARKER_SPHERE, MARKER_CYLINDER,
  MARKER_LINE_STRIP, MARKER_LINE_LIST, MARKER_CUBE_LIST,
  MARKER_SPHERE_LIST, MARKER_POINTS, MARKER_TEXT, MARKER_TRIANGLE_LIST,
} from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";
import { MapLayer } from "./MapLayer";

// ==================== MARKER LAYER ====================
// Renders visualization_msgs/Marker and MarkerArray messages.
// Each marker is keyed by (ns, id) and rendered as Three.js objects.

type CachedMarker = {
  msg: MarkerMessage;
  dirty: boolean;
};

export class MarkerLayer implements MapLayer {
  readonly id: string;
  readonly type: LayerType = "marker";
  topic: string;
  private color: string;
  private opacity: number;
  private group = new THREE.Group();
  private markerCache = new Map<string, CachedMarker>();
  private objectCache = new Map<string, THREE.Object3D>();
  private dirty = false;

  // Shared geometries (reused across markers)
  private static boxGeom: THREE.BoxGeometry | null = null;
  private static sphereGeom: THREE.SphereGeometry | null = null;
  private static cylGeom: THREE.CylinderGeometry | null = null;

  constructor(config: LayerConfig) {
    this.id = config.id;
    this.topic = config.topic;
    this.color = config.color;
    this.opacity = config.opacity;
    this.group.visible = config.visible;
  }

  private static getBoxGeom(): THREE.BoxGeometry {
    if (!this.boxGeom) this.boxGeom = new THREE.BoxGeometry(1, 1, 1);
    return this.boxGeom;
  }
  private static getSphereGeom(): THREE.SphereGeometry {
    if (!this.sphereGeom) this.sphereGeom = new THREE.SphereGeometry(0.5, 16, 12);
    return this.sphereGeom;
  }
  private static getCylGeom(): THREE.CylinderGeometry {
    if (!this.cylGeom) this.cylGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    return this.cylGeom;
  }

  private markerKey(ns: string, id: number): string {
    return `${ns}/${id}`;
  }

  processMessages(messages: readonly MessageEvent[]): void {
    for (const msg of messages) {
      if (msg.topic !== this.topic) continue;
      const data = msg.message as any;

      // Handle MarkerArray (has .markers array)
      if (data.markers && Array.isArray(data.markers)) {
        const arr = data as MarkerArrayMessage;
        for (const m of arr.markers) {
          this.processMarker(m);
        }
      }
      // Handle single Marker
      else if (data.type != null && data.pose != null) {
        this.processMarker(data as MarkerMessage);
      }
    }
  }

  private processMarker(m: MarkerMessage): void {
    const key = this.markerKey(m.ns ?? "", m.id ?? 0);

    // DELETE
    if (m.action === 2) {
      this.markerCache.delete(key);
      const obj = this.objectCache.get(key);
      if (obj) {
        this.group.remove(obj);
        this.disposeObject(obj);
        this.objectCache.delete(key);
      }
      return;
    }
    // DELETEALL
    if (m.action === 3) {
      this.markerCache.clear();
      for (const obj of this.objectCache.values()) {
        this.group.remove(obj);
        this.disposeObject(obj);
      }
      this.objectCache.clear();
      return;
    }

    // ADD or MODIFY
    this.markerCache.set(key, { msg: m, dirty: true });
    this.dirty = true;
  }

  updateVisualization(transformer: GlobeTransformer): void {
    if (!this.dirty) return;
    this.dirty = false;

    for (const [key, cached] of this.markerCache) {
      if (!cached.dirty) continue;
      cached.dirty = false;

      const m = cached.msg;
      const frameId = m.header?.frame_id || transformer.fixedFrame;

      // Transform marker pose to local coords
      const pos = transformer.transformToLocal(
        new THREE.Vector3(
          m.pose.position.x,
          m.pose.position.y,
          m.pose.position.z,
        ),
        frameId,
      );
      if (!pos) continue;

      const orient = transformer.transformOrientationToLocal(
        new THREE.Quaternion(
          m.pose.orientation.x,
          m.pose.orientation.y,
          m.pose.orientation.z,
          m.pose.orientation.w,
        ),
        frameId,
      );

      // Remove old object if type changed
      const existing = this.objectCache.get(key);

      let obj: THREE.Object3D | null = null;

      switch (m.type) {
        case MARKER_ARROW:
          obj = this.createArrow(m, pos, orient);
          break;
        case MARKER_CUBE:
          obj = this.createMesh(m, pos, orient, MarkerLayer.getBoxGeom());
          break;
        case MARKER_SPHERE:
          obj = this.createMesh(m, pos, orient, MarkerLayer.getSphereGeom());
          break;
        case MARKER_CYLINDER:
          obj = this.createMesh(m, pos, orient, MarkerLayer.getCylGeom());
          break;
        case MARKER_LINE_STRIP:
          obj = this.createLineStrip(m, pos, orient, transformer);
          break;
        case MARKER_LINE_LIST:
          obj = this.createLineList(m, pos, orient, transformer);
          break;
        case MARKER_CUBE_LIST:
          obj = this.createInstancedList(m, transformer, MarkerLayer.getBoxGeom());
          break;
        case MARKER_SPHERE_LIST:
          obj = this.createInstancedList(m, transformer, MarkerLayer.getSphereGeom());
          break;
        case MARKER_POINTS:
          obj = this.createPoints(m, transformer);
          break;
        case MARKER_TEXT:
          obj = this.createText(m, pos);
          break;
        case MARKER_TRIANGLE_LIST:
          obj = this.createTriangleList(m, pos, orient, transformer);
          break;
        default:
          continue;
      }

      if (obj) {
        obj.renderOrder = 950;
        if (existing) {
          this.group.remove(existing);
          this.disposeObject(existing);
        }
        this.group.add(obj);
        this.objectCache.set(key, obj);
      }
    }
  }

  private getMarkerColor(m: MarkerMessage): THREE.Color {
    if (m.color && (m.color.r > 0 || m.color.g > 0 || m.color.b > 0)) {
      return new THREE.Color(m.color.r, m.color.g, m.color.b);
    }
    return new THREE.Color(this.color);
  }

  private getMarkerAlpha(m: MarkerMessage): number {
    if (m.color && m.color.a > 0) return m.color.a * this.opacity;
    return this.opacity;
  }

  private createMesh(
    m: MarkerMessage,
    pos: THREE.Vector3,
    orient: THREE.Quaternion | null,
    geom: THREE.BufferGeometry,
  ): THREE.Mesh {
    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.MeshStandardMaterial({
      color: this.getMarkerColor(m),
      transparent: alpha < 1,
      opacity: alpha,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    if (orient) mesh.quaternion.copy(orient);
    mesh.scale.set(m.scale.x || 1, m.scale.y || 1, m.scale.z || 1);
    return mesh;
  }

  private createArrow(
    m: MarkerMessage,
    pos: THREE.Vector3,
    orient: THREE.Quaternion | null,
  ): THREE.Object3D {
    const color = this.getMarkerColor(m);
    const alpha = this.getMarkerAlpha(m);

    // If marker has points (start/end), draw line + cone
    if (m.points && m.points.length >= 2) {
      const group = new THREE.Group();
      const start = new THREE.Vector3(m.points[0]!.x, m.points[0]!.y, m.points[0]!.z);
      const end = new THREE.Vector3(m.points[1]!.x, m.points[1]!.y, m.points[1]!.z);
      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      if (length < 0.001) return group;

      const shaftLen = length * 0.8;
      const headLen = length * 0.2;
      const shaftRadius = (m.scale.x || 0.05) * 0.5;
      const headRadius = (m.scale.y || 0.1) * 0.5;

      const arrowHelper = new THREE.ArrowHelper(
        dir.normalize(), start, length, color.getHex(),
        headLen, headRadius,
      );
      group.add(arrowHelper);
      group.position.copy(pos);
      if (orient) group.quaternion.copy(orient);
      return group;
    }

    // Simple arrow from scale
    const length = m.scale.x || 1;
    const arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(), length,
      color.getHex(), length * 0.3, (m.scale.y || 0.1) * 0.5,
    );
    arrowHelper.position.copy(pos);
    if (orient) arrowHelper.quaternion.copy(orient);
    return arrowHelper;
  }

  private createLineStrip(
    m: MarkerMessage,
    pos: THREE.Vector3,
    orient: THREE.Quaternion | null,
    transformer: GlobeTransformer,
  ): THREE.Line | null {
    if (!m.points || m.points.length < 2) return null;

    const frameId = m.header?.frame_id || transformer.fixedFrame;
    const points: THREE.Vector3[] = [];
    for (const p of m.points) {
      const local = transformer.transformToLocal(
        new THREE.Vector3(p.x, p.y, p.z), frameId,
      );
      if (local) points.push(local);
    }
    if (points.length < 2) return null;

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.LineBasicMaterial({
      color: this.getMarkerColor(m),
      linewidth: Math.max(1, m.scale.x || 1),
      depthTest: false,
      transparent: alpha < 1,
      opacity: alpha,
    });
    const line = new THREE.Line(geom, mat);
    // Position already in local coords from transformToLocal, so no additional offset
    return line;
  }

  private createLineList(
    m: MarkerMessage,
    pos: THREE.Vector3,
    orient: THREE.Quaternion | null,
    transformer: GlobeTransformer,
  ): THREE.LineSegments | null {
    if (!m.points || m.points.length < 2) return null;

    const frameId = m.header?.frame_id || transformer.fixedFrame;
    const points: THREE.Vector3[] = [];
    for (const p of m.points) {
      const local = transformer.transformToLocal(
        new THREE.Vector3(p.x, p.y, p.z), frameId,
      );
      if (local) points.push(local);
    }
    if (points.length < 2) return null;

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.LineBasicMaterial({
      color: this.getMarkerColor(m),
      linewidth: Math.max(1, m.scale.x || 1),
      depthTest: false,
      transparent: alpha < 1,
      opacity: alpha,
    });
    return new THREE.LineSegments(geom, mat);
  }

  private createInstancedList(
    m: MarkerMessage,
    transformer: GlobeTransformer,
    geom: THREE.BufferGeometry,
  ): THREE.InstancedMesh | null {
    if (!m.points || m.points.length === 0) return null;

    const frameId = m.header?.frame_id || transformer.fixedFrame;
    const count = m.points.length;
    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.MeshStandardMaterial({
      color: this.getMarkerColor(m),
      transparent: alpha < 1,
      opacity: alpha,
      depthTest: false,
    });

    const dummy = new THREE.Matrix4();
    const scale = new THREE.Vector3(m.scale.x || 0.1, m.scale.y || 0.1, m.scale.z || 0.1);

    // First pass: collect valid instances to avoid phantom markers at origin
    const validInstances: { local: THREE.Vector3; color?: { r: number; g: number; b: number } }[] = [];
    for (let i = 0; i < count; i++) {
      const p = m.points[i]!;
      const local = transformer.transformToLocal(
        new THREE.Vector3(p.x, p.y, p.z), frameId,
      );
      if (!local) continue;
      validInstances.push({ local, color: m.colors?.[i] });
    }
    if (validInstances.length === 0) return null;

    const mesh = new THREE.InstancedMesh(geom, mat, validInstances.length);
    for (let i = 0; i < validInstances.length; i++) {
      const inst = validInstances[i]!;
      dummy.compose(inst.local, new THREE.Quaternion(), scale);
      mesh.setMatrixAt(i, dummy);

      if (inst.color) {
        mesh.setColorAt(i, new THREE.Color(inst.color.r, inst.color.g, inst.color.b));
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = 950;
    return mesh;
  }

  private createPoints(
    m: MarkerMessage,
    transformer: GlobeTransformer,
  ): THREE.Points | null {
    if (!m.points || m.points.length === 0) return null;

    const frameId = m.header?.frame_id || transformer.fixedFrame;
    const posArr: number[] = [];
    const colorArr: number[] = [];
    const baseColor = this.getMarkerColor(m);

    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i]!;
      const local = transformer.transformToLocal(
        new THREE.Vector3(p.x, p.y, p.z), frameId,
      );
      if (!local) continue;
      posArr.push(local.x, local.y, local.z);
      if (m.colors && m.colors[i]) {
        const c = m.colors[i]!;
        colorArr.push(c.r, c.g, c.b);
      } else {
        colorArr.push(baseColor.r, baseColor.g, baseColor.b);
      }
    }

    if (posArr.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colorArr, 3));

    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.PointsMaterial({
      size: Math.max(0.02, (m.scale.x || 0.05)),
      vertexColors: true,
      sizeAttenuation: true,
      depthTest: false,
      transparent: alpha < 1,
      opacity: alpha,
    });
    return new THREE.Points(geom, mat);
  }

  private createText(m: MarkerMessage, pos: THREE.Vector3): THREE.Sprite | null {
    if (!m.text) return null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const fontSize = 48;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const measured = ctx.measureText(m.text);
    const pad = 12;
    canvas.width = Math.ceil(measured.width + pad * 2);
    canvas.height = Math.ceil(fontSize * 1.4 + pad * 2);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 6);
    ctx.fill();

    const c = this.getMarkerColor(m);
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.text, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.SpriteMaterial({
      map: tex, depthTest: false, transparent: true, opacity: alpha,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    const height = m.scale.z || 1;
    const aspect = canvas.width / canvas.height;
    sprite.scale.set(height * aspect, height, 1);
    return sprite;
  }

  private createTriangleList(
    m: MarkerMessage,
    pos: THREE.Vector3,
    orient: THREE.Quaternion | null,
    transformer: GlobeTransformer,
  ): THREE.Mesh | null {
    if (!m.points || m.points.length < 3) return null;

    const frameId = m.header?.frame_id || transformer.fixedFrame;
    const vertices: number[] = [];
    const colors: number[] = [];
    const baseColor = this.getMarkerColor(m);

    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i]!;
      const local = transformer.transformToLocal(
        new THREE.Vector3(p.x, p.y, p.z), frameId,
      );
      if (!local) continue;
      vertices.push(local.x, local.y, local.z);
      if (m.colors && m.colors[i]) {
        const c = m.colors[i]!;
        colors.push(c.r, c.g, c.b);
      } else {
        colors.push(baseColor.r, baseColor.g, baseColor.b);
      }
    }

    if (vertices.length < 9) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const alpha = this.getMarkerAlpha(m);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: alpha < 1,
      opacity: alpha,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geom, mat);
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // Don't dispose shared geometries
        if (
          mesh.geometry !== MarkerLayer.boxGeom &&
          mesh.geometry !== MarkerLayer.sphereGeom &&
          mesh.geometry !== MarkerLayer.cylGeom
        ) {
          mesh.geometry?.dispose();
        }
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
      }
      if ((child as THREE.Sprite).isSprite) {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    });
  }

  setVisible(v: boolean): void { this.group.visible = v; }

  setColor(c: string): void {
    this.color = c;
    // Re-mark all as dirty so they pick up the new color on next update
    for (const cached of this.markerCache.values()) {
      cached.dirty = true;
    }
    this.dirty = true;
  }

  setOpacity(o: number): void {
    this.opacity = o;
    for (const cached of this.markerCache.values()) {
      cached.dirty = true;
    }
    this.dirty = true;
  }

  getGroup(): THREE.Group { return this.group; }

  dispose(): void {
    for (const obj of this.objectCache.values()) {
      this.disposeObject(obj);
    }
    this.objectCache.clear();
    this.markerCache.clear();
    this.group.clear();
  }
}
