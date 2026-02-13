import { MessageEvent } from "@foxglove/extension";
import * as THREE from "three";
import { LayerType } from "../types";
import { GlobeTransformer } from "../systems/GlobeTransformer";

// ==================== MAP LAYER INTERFACE ====================

export interface MapLayer {
  readonly id: string;
  readonly type: LayerType;
  topic: string;
  /** Ingest new messages — caches raw data */
  processMessages(messages: readonly MessageEvent[]): void;
  /** Rebuild visualization using current transformer */
  updateVisualization(transformer: GlobeTransformer): void;
  setVisible(visible: boolean): void;
  setColor(color: string): void;
  setOpacity(opacity: number): void;
  dispose(): void;
  getGroup(): THREE.Group;
}
