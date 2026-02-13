import * as THREE from "three";
import { TFTransformStamped } from "../types";

// ==================== TF SYSTEM ====================

export type FrameNode = {
  parentId: string | null;
  children: Set<string>;
  localTransform: THREE.Matrix4;
};

export class TFSystem {
  private frames: Map<string, FrameNode> = new Map();

  /** Process incoming TF transforms (from /tf or /tf_static) */
  updateTransforms(transforms: TFTransformStamped[]): void {
    for (const tf of transforms) {
      const parentId = tf.header.frame_id;
      const childId = tf.child_frame_id;

      // Ensure parent node exists
      if (!this.frames.has(parentId)) {
        this.frames.set(parentId, {
          parentId: null,
          children: new Set(),
          localTransform: new THREE.Matrix4(),
        });
      }

      // Create or update child node
      let childNode = this.frames.get(childId);
      if (!childNode) {
        childNode = {
          parentId: null,
          children: new Set(),
          localTransform: new THREE.Matrix4(),
        };
        this.frames.set(childId, childNode);
      }

      // Update parent linkage
      if (childNode.parentId && childNode.parentId !== parentId) {
        const oldParent = this.frames.get(childNode.parentId);
        if (oldParent) oldParent.children.delete(childId);
      }
      childNode.parentId = parentId;
      this.frames.get(parentId)!.children.add(childId);

      // Build transform matrix from translation + rotation
      const t = tf.transform.translation;
      const r = tf.transform.rotation;
      const quat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const pos = new THREE.Vector3(t.x, t.y, t.z);
      childNode.localTransform.compose(pos, quat, new THREE.Vector3(1, 1, 1));
    }
  }

  /**
   * Get world transform of a frame relative to the tree root.
   * Walks up the parent chain, multiplying transforms root-down.
   */
  getWorldTransform(frameId: string): THREE.Matrix4 | null {
    const node = this.frames.get(frameId);
    if (!node) return null;

    const chain: THREE.Matrix4[] = [];
    let current: FrameNode | undefined = node;
    let currentId: string | null = frameId;
    const visited = new Set<string>();

    while (currentId && current) {
      if (visited.has(currentId)) return null; // cycle detection
      visited.add(currentId);
      chain.push(current.localTransform);
      currentId = current.parentId;
      current = currentId ? this.frames.get(currentId) : undefined;
    }

    // Multiply from root down: chain[last] * chain[last-1] * ... * chain[0]
    const result = new THREE.Matrix4();
    for (let i = chain.length - 1; i >= 0; i--) {
      result.multiply(chain[i]!);
    }
    return result;
  }

  /**
   * Get transform of targetFrame relative to anchorFrame.
   * T_anchor_target = inverse(T_world_anchor) * T_world_target
   */
  getRelativeTransform(targetFrame: string, anchorFrame: string): THREE.Matrix4 | null {
    if (targetFrame === anchorFrame) return new THREE.Matrix4();

    const anchorWorld = this.getWorldTransform(anchorFrame);
    const targetWorld = this.getWorldTransform(targetFrame);
    if (!anchorWorld || !targetWorld) return null;

    const anchorInv = anchorWorld.clone().invert();
    return anchorInv.multiply(targetWorld);
  }

  getFrameIds(): string[] {
    return [...this.frames.keys()];
  }

  getParentId(frameId: string): string | null {
    return this.frames.get(frameId)?.parentId ?? null;
  }

  hasFrame(frameId: string): boolean {
    return this.frames.has(frameId);
  }

  clear(): void {
    this.frames.clear();
  }
}
