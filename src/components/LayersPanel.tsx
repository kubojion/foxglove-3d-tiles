import React, { useState } from "react";
import { Topic } from "@foxglove/extension";
import { Config, LayerType, LayerConfig } from "../types";
import { TopicSelect } from "./SettingsPanel";
import { LayersIcon } from "./Icons";

// ==================== TOOLTIP (local copy) ====================
function InfoIcon({ tooltip }: { tooltip: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", position: "relative" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: "14px", height: "14px", borderRadius: "50%", border: "1px solid #666",
        color: "#888", fontSize: "9px", fontWeight: "bold", cursor: "help",
        marginLeft: "4px", flexShrink: 0, lineHeight: 1,
      }}>?</span>
      {show && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)", backgroundColor: "rgba(25, 25, 25, 0.97)",
          color: "#ccc", border: "1px solid #555", borderRadius: "6px",
          padding: "10px 14px", fontSize: "12px", lineHeight: "1.5",
          whiteSpace: "normal", width: "260px", zIndex: 3000, pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)", textAlign: "center",
        }}>
          {tooltip}
        </div>
      )}
    </span>
  );
}

// ==================== LAYERS PANEL ====================

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  backgroundColor: "#3c3c3c",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: "3px",
  fontSize: "13px",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#aaa",
  marginBottom: "4px",
  display: "block",
};

const sectionStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #444",
};

// Small action button
const actionBtn = (
  label: string,
  onClick: () => void,
  extraStyle?: React.CSSProperties,
): React.ReactElement => (
  <button
    onClick={onClick}
    style={{
      padding: "4px 10px", fontSize: "11px", cursor: "pointer",
      backgroundColor: "#4a4a4a", color: "#ccc",
      border: "1px solid #666", borderRadius: "3px",
      ...extraStyle,
    }}
  >
    {label}
  </button>
);

export function LayersPanel({
  config,
  onConfigChange,
  topics,
}: {
  config: Config;
  onConfigChange: (c: Partial<Config>) => void;
  topics: readonly Topic[];
}) {
  const updateLayer = (id: string, patch: Partial<LayerConfig>) => {
    onConfigChange({ layers: config.layers.map((l) => l.id === id ? { ...l, ...patch } : l) });
  };

  const [newLayerType, setNewLayerType] = useState<LayerType>("navsat");

  const addLayer = () => {
    const colorMap: Record<LayerType, string> = {
      path: "#00ff00", odometry: "#ff8800", navsat: "#ff00ff",
      marker: "#00ccff", costmap: "#ffcc00",
    };
    const newLayer: LayerConfig = {
      id: Date.now().toString(36),
      type: newLayerType,
      topic: "",
      color: colorMap[newLayerType] || "#00ff00",
      opacity: newLayerType === "costmap" ? 0.6 : 1,
      visible: true,
      buffer: 1000,
      showLine: true,
    };
    onConfigChange({ layers: [...config.layers, newLayer] });
  };

  return (
    <div style={{ padding: "8px 0" }}>
      <h3 style={{ margin: "12px 16px 8px", fontSize: "15px", color: "#ddd", display: "flex", alignItems: "center" }}>
        <LayersIcon size={16} /> Visualization Layers
      </h3>

      {/* Add Layer — prominent at the top */}
      <div style={{ padding: "8px 16px 12px", borderBottom: "1px solid #444" }}>
        <div style={{
          display: "flex", gap: "6px", alignItems: "center",
          padding: "8px 10px",
          backgroundColor: "rgba(111,59,232,0.1)",
          border: "1px dashed rgba(111,59,232,0.5)",
          borderRadius: "6px",
        }}>
          <select
            value={newLayerType}
            onChange={(e) => setNewLayerType(e.target.value as LayerType)}
            style={{ ...inputStyle, flex: 1, fontSize: "12px" }}
          >
            <option value="navsat">NavSat</option>
            <option value="path">Path</option>
            <option value="odometry">Odometry</option>
            <option value="marker">Marker</option>
            <option value="costmap">Costmap</option>
          </select>
          <button
            onClick={addLayer}
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: "bold",
              cursor: "pointer",
              backgroundColor: "#6f3be8",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              whiteSpace: "nowrap",
            }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Layer list */}
      <div style={sectionStyle}>
        {config.layers.map((layer, layerIdx) => (
          <div key={layer.id} style={{ backgroundColor: "#333", borderRadius: "4px", padding: "8px", marginBottom: "6px", border: "1px solid #444" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", color: "#a78bfa", fontWeight: "bold", textTransform: "uppercase" }}>
                {layer.type}
              </span>
              <div style={{ display: "flex", gap: "2px" }}>
                {actionBtn("▲", () => {
                  if (layerIdx === 0) return;
                  const arr = [...config.layers];
                  [arr[layerIdx - 1], arr[layerIdx]] = [arr[layerIdx]!, arr[layerIdx - 1]!];
                  onConfigChange({ layers: arr });
                }, { padding: "2px 6px", opacity: layerIdx === 0 ? 0.3 : 1 })}
                {actionBtn("▼", () => {
                  if (layerIdx === config.layers.length - 1) return;
                  const arr = [...config.layers];
                  [arr[layerIdx], arr[layerIdx + 1]] = [arr[layerIdx + 1]!, arr[layerIdx]!];
                  onConfigChange({ layers: arr });
                }, { padding: "2px 6px", opacity: layerIdx === config.layers.length - 1 ? 0.3 : 1 })}
                {actionBtn(
                  layer.visible ? "Visible" : "Hidden",
                  () => updateLayer(layer.id, { visible: !layer.visible }),
                  { color: layer.visible ? "#fff" : "#666" },
                )}
                {actionBtn(
                  "Delete",
                  () => onConfigChange({ layers: config.layers.filter((l) => l.id !== layer.id) }),
                  { color: "#c66" },
                )}
              </div>
            </div>

            <label style={labelStyle}>Topic</label>
            <div style={{ marginBottom: "6px" }}>
              <TopicSelect
                value={layer.topic}
                onChange={(v) => updateLayer(layer.id, { topic: v })}
                topics={topics}
                filter={(t) => {
                  const s = (t.schemaName || t.datatype || "").toLowerCase();
                  const n = t.name.toLowerCase();
                  if (layer.type === "navsat") {
                    return s.includes("navsatfix") || s.includes("navsat") || n.includes("fix") || n.includes("gps");
                  }
                  if (layer.type === "odometry") {
                    return s.includes("odometry") || n.includes("odom");
                  }
                  if (layer.type === "path") {
                    return s.includes("path") || s.includes("navsatfix") || s.includes("odometry") || n.includes("path") || n.includes("odom") || n.includes("gps") || n.includes("fix");
                  }
                  if (layer.type === "marker") {
                    return s.includes("marker") || s.includes("visualization") || n.includes("marker") || n.includes("visualization");
                  }
                  if (layer.type === "costmap") {
                    return s.includes("occupancygrid") || s.includes("occupancy") || n.includes("costmap") || n.includes("map") || n.includes("grid");
                  }
                  return true;
                }}
                inputStyle={inputStyle}
              />
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0 }}>Color</label>
              <input type="color" value={layer.color}
                onChange={(e) => updateLayer(layer.id, { color: e.target.value })}
                style={{ width: "32px", height: "24px", border: "none", cursor: "pointer", backgroundColor: "transparent" }} />
              <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0, marginLeft: "8px" }}>Opacity</label>
              <input type="range" min="0.1" max="1" step="0.1" value={layer.opacity}
                onChange={(e) => updateLayer(layer.id, { opacity: Number(e.target.value) })}
                style={{ flex: 1 }} />
            </div>

            {(layer.type === "navsat" || layer.type === "path") && (
              <>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0 }}>Buffer</label>
                  <input type="number" min="10" max="100000" value={layer.buffer || 1000}
                    onChange={(e) => updateLayer(layer.id, { buffer: Math.max(10, Number(e.target.value) || 1000) })}
                    style={{ ...inputStyle, width: "80px", flex: "0 0 auto" }} />
                  <span style={{ fontSize: "11px", color: "#888" }}>points</span>
                </div>
              </>
            )}

            {layer.type === "navsat" && (
              <>
                <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "6px", cursor: "pointer" }}>
                  <input type="checkbox" checked={layer.showLine !== false}
                    onChange={(e) => updateLayer(layer.id, { showLine: e.target.checked })}
                    style={{ marginRight: "8px" }} />
                  Show Connecting Line
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0 }}>Pos. Tolerance</label>
                  <input type="range" min="0" max="5" step="0.1" value={layer.positionTolerance ?? 0}
                    onChange={(e) => updateLayer(layer.id, { positionTolerance: Number(e.target.value) })}
                    style={{ flex: 1 }} />
                  <span style={{ fontSize: "11px", color: "#888", width: "36px", textAlign: "right" }}>
                    {(layer.positionTolerance ?? 0).toFixed(1)}m
                  </span>
                </div>
              </>
            )}
          </div>
        ))}

        {config.layers.length === 0 && (
          <div style={{ fontSize: "12px", color: "#666", fontStyle: "italic", padding: "8px 0" }}>
            No layers added yet. Use + Add above.
          </div>
        )}
      </div>

      {/* ====== GRID OVERLAY (collapsible) ====== */}
      <GridOverlaySection config={config} onConfigChange={onConfigChange} />
    </div>
  );
}

// ==================== GRID OVERLAY SECTION ====================
function GridOverlaySection({
  config,
  onConfigChange,
}: {
  config: Config;
  onConfigChange: (c: Partial<Config>) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "6px 8px", backgroundColor: "#3c3c3c",
    color: "#fff", border: "1px solid #555", borderRadius: "3px",
    fontSize: "13px", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "12px", color: "#aaa", marginBottom: "4px", display: "block",
  };

  return (
    <div style={{ borderTop: "1px solid #444" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "10px 16px",
          background: "none", border: "none", cursor: "pointer",
          color: "#a78bfa", fontSize: "13px", fontWeight: "bold",
          textAlign: "left",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          Grid Overlay
          <InfoIcon tooltip="Flat grid anchored to the fixed frame origin (same as RViz). Useful for judging distances." />
        </span>
        <span style={{ fontSize: "10px", color: "#888", transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 12px" }}>
          <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "6px" }}>
            <input type="checkbox" checked={config.showGrid}
              onChange={(e) => onConfigChange({ showGrid: e.target.checked })}
              style={{ marginRight: "8px" }} />
            Show Grid
          </label>
          {config.showGrid && (
            <>
              <label style={labelStyle}>Grid Extent (m)</label>
              <input
                type="range" min="20" max="1000" step="10"
                value={config.gridSize}
                onChange={(e) => onConfigChange({ gridSize: Number(e.target.value) })}
                style={{ width: "100%", marginBottom: "2px" }}
              />
              <div style={{ fontSize: "11px", color: "#888" }}>{config.gridSize}m × {config.gridSize}m</div>

              <label style={labelStyle}>Cell Spacing (m)</label>
              <input
                type="range" min="1" max="20" step="1"
                value={config.gridSpacing}
                onChange={(e) => onConfigChange({ gridSpacing: Number(e.target.value) })}
                style={{ width: "100%", marginBottom: "2px" }}
              />
              <div style={{ fontSize: "11px", color: "#888" }}>{config.gridSpacing}m</div>

              {config.mapSource !== "osm" && (
                <>
                  <label style={labelStyle}>Height Offset (m)</label>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="range" min="-10" max="10" step="0.1"
                      value={config.gridHeightOffset}
                      onChange={(e) => onConfigChange({ gridHeightOffset: Number(e.target.value) })}
                      style={{ flex: 1 }}
                    />
                    <input
                      type="number" step="0.1"
                      value={config.gridHeightOffset}
                      onChange={(e) => onConfigChange({ gridHeightOffset: Number(e.target.value) || 0 })}
                      style={{ ...inputStyle, width: "60px", flex: "0 0 auto" }}
                    />
                  </div>
                </>
              )}

              <label style={labelStyle}>Line Width</label>
              <input
                type="range" min="1" max="5" step="1"
                value={config.gridLineWidth}
                onChange={(e) => onConfigChange({ gridLineWidth: Number(e.target.value) })}
                style={{ width: "100%", marginBottom: "2px" }}
              />
              <div style={{ fontSize: "11px", color: "#888" }}>{config.gridLineWidth}px (hardware-dependent)</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
