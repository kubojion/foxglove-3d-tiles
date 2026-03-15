import React, { useState } from "react";
import { Topic } from "@foxglove/extension";
import { Config, WaypointData } from "../types";
import { TopicSelect } from "./SettingsPanel";
import { WaypointIcon } from "./Icons";

// ==================== WAYPOINT PANEL ====================

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

export function WaypointPanel({
  config,
  onConfigChange,
  topics,
  waypoints,
  onRemoveWaypoint,
  onClearAll,
  interactionMode,
  onModeChange,
}: {
  config: Config;
  onConfigChange: (c: Partial<Config>) => void;
  topics: readonly Topic[];
  waypoints: WaypointData[];
  onRemoveWaypoint: (index: number) => void;
  onClearAll: () => void;
  interactionMode: "none" | "waypoint" | "measure";
  onModeChange: (mode: "none" | "waypoint" | "measure") => void;
}) {
  const RAD2DEG = 180 / Math.PI;
  const isActive = interactionMode === "waypoint";
  // Auto-detect mode from topic name: /goal_pose → PoseStamped, else → PointStamped
  const isPoseMode = (config.waypointTopic || "").includes("goal_pose");

  return (
    <div style={{ padding: "8px 0" }}>
      <h3 style={{ margin: "12px 16px 8px", fontSize: "15px", color: "#ddd", display: "flex", alignItems: "center" }}>
        <WaypointIcon size={16} /> Waypoint
      </h3>

      {/* ON / OFF toggle */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#a78bfa" }}>Placement Mode</h4>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => onModeChange("waypoint")}
            style={{
              flex: 1,
              padding: "7px 0",
              backgroundColor: isActive ? "rgba(76,175,80,0.25)" : "#3c3c3c",
              border: `1px solid ${isActive ? "#4caf50" : "#555"}`,
              color: isActive ? "#81c784" : "#aaa",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: isActive ? "bold" : "normal",
            }}
          >
            ON
          </button>
          <button
            onClick={() => onModeChange("none")}
            style={{
              flex: 1,
              padding: "7px 0",
              backgroundColor: !isActive ? "rgba(255,255,255,0.08)" : "#3c3c3c",
              border: `1px solid ${!isActive ? "#888" : "#555"}`,
              color: !isActive ? "#ddd" : "#aaa",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: !isActive ? "bold" : "normal",
            }}
          >
            OFF
          </button>
        </div>
        {isActive && (
          <div style={{
            marginTop: "6px",
            fontSize: "10px",
            color: "#81c784",
          }}>
            Click on the grid to place waypoints
          </div>
        )}
      </div>

      {/* Publishing Config */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#a78bfa" }}>Topic</h4>

        {/* Quick-select preset topics */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
          <button
            onClick={() => onConfigChange({ waypointTopic: "/clicked_point" })}
            style={{
              flex: 1,
              padding: "5px 4px",
              backgroundColor: !isPoseMode ? "rgba(111,59,232,0.15)" : "#3c3c3c",
              border: `1px solid ${!isPoseMode ? "#8b5cf6" : "#555"}`,
              color: !isPoseMode ? "#c4b5fd" : "#aaa",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            /clicked_point
          </button>
          <button
            onClick={() => onConfigChange({ waypointTopic: "/goal_pose" })}
            style={{
              flex: 1,
              padding: "5px 4px",
              backgroundColor: isPoseMode ? "rgba(111,59,232,0.15)" : "#3c3c3c",
              border: `1px solid ${isPoseMode ? "#8b5cf6" : "#555"}`,
              color: isPoseMode ? "#c4b5fd" : "#aaa",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            /goal_pose
          </button>
        </div>

        <label style={labelStyle}>Or select from available topics</label>
        <TopicSelect
          value={config.waypointTopic}
          onChange={(val) => onConfigChange({ waypointTopic: val })}
          topics={topics}
          placeholder="/clicked_point"
          inputStyle={inputStyle}
          filter={(t) => {
            const s = (t.schemaName || "").toLowerCase();
            return s.includes("pointstamped") || s.includes("posestamped") || s.includes("pose") || s.includes("point");
          }}
        />

        {/* Auto-detected mode info */}
        <div style={{
          marginTop: "8px",
          padding: "6px 8px",
          backgroundColor: "rgba(255,255,255,0.04)",
          border: "1px solid #444",
          borderRadius: "3px",
          fontSize: "10px",
          color: "#999",
          lineHeight: "1.5",
        }}>
          {isPoseMode ? (
            <>Mode: <strong style={{ color: "#bbb" }}>PoseStamped</strong> — like RViz 2D Nav Goal<br/>Publishes (x, y) in meters, frame: <code>map</code></>
          ) : (
            <>Mode: <strong style={{ color: "#bbb" }}>PointStamped</strong> — like MapViz<br/>Publishes (lon, lat) in GPS, frame: <code>wgs84</code></>
          )}
        </div>
      </div>

      {/* Usage help */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", color: "#a78bfa" }}>How to Use</h4>
        <div style={{ fontSize: "11px", color: "#aaa", lineHeight: "1.6" }}>
          <div><strong>1.</strong> Enable Grid Overlay in Settings</div>
          <div><strong>2.</strong> Turn placement mode ON above</div>
          <div><strong>3.</strong> Click on grid to place waypoints</div>
          <div><strong>4.</strong> Drag after clicking to set heading direction</div>
        </div>
      </div>

      {/* Waypoint List */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <h4 style={{ margin: 0, fontSize: "13px", color: "#a78bfa" }}>
            Waypoints ({waypoints.length})
          </h4>
          {waypoints.length > 0 && (
            <button
              onClick={onClearAll}
              style={{
                padding: "3px 10px",
                fontSize: "11px",
                backgroundColor: "#5a2020",
                color: "#ff8888",
                border: "1px solid #883333",
                borderRadius: "3px",
                cursor: "pointer",
              }}
            >
              Clear All
            </button>
          )}
        </div>

        {waypoints.length === 0 ? (
          <div style={{ fontSize: "12px", color: "#666", fontStyle: "italic", padding: "8px 0" }}>
            No waypoints placed yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {waypoints.map((wp, i) => (
              <div
                key={wp.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 8px",
                  backgroundColor: "#363636",
                  borderRadius: "3px",
                  border: "1px solid #4a4a4a",
                }}
              >
                <span style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: "#ff6666",
                  width: "20px",
                  textAlign: "center",
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1, fontSize: "10px", color: "#bbb", fontFamily: "monospace", lineHeight: "1.4" }}>
                  {isPoseMode ? (
                    <>
                      <div>x: {wp.localPosition.x.toFixed(2)} m</div>
                      <div>y: {wp.localPosition.y.toFixed(2)} m</div>
                      <div>hdg: {(wp.heading * RAD2DEG).toFixed(1)}°</div>
                    </>
                  ) : (
                    <>
                      <div>lat: {wp.lat.toFixed(7)}</div>
                      <div>lon: {wp.lon.toFixed(7)}</div>
                      <div>hdg: {(wp.heading * RAD2DEG).toFixed(1)}°</div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => onRemoveWaypoint(i)}
                  title="Remove waypoint"
                  style={{
                    padding: "2px 6px",
                    fontSize: "11px",
                    backgroundColor: "transparent",
                    color: "#888",
                    border: "1px solid #555",
                    borderRadius: "3px",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export */}
      {waypoints.length > 0 && (
        <ExportSection waypoints={waypoints} isPoseMode={isPoseMode} />
      )}
    </div>
  );
}

// ==================== EXPORT SECTION ====================

type ExportFormat = "yaml" | "geojson" | "csv";

function ExportSection({ waypoints, isPoseMode }: { waypoints: WaypointData[]; isPoseMode: boolean }) {
  const [exportMsg, setExportMsg] = useState("");
  const RAD2DEG = 180 / Math.PI;

  const generateContent = (format: ExportFormat): { content: string; filename: string; mime: string } => {
    switch (format) {
      case "yaml": {
        // Matches save_gps_waypoints.py format
        const lines = ["waypoints:"];
        for (const wp of waypoints) {
          lines.push(`- latitude: ${wp.lat.toFixed(10)}`);
          lines.push(`  longitude: ${wp.lon.toFixed(10)}`);
          lines.push(`  yaw: ${(wp.heading * RAD2DEG).toFixed(4)}`);
        }
        return { content: lines.join("\n") + "\n", filename: "waypoints.yaml", mime: "text/yaml" };
      }
      case "geojson": {
        const features = waypoints.map((wp, i) => ({
          type: "Feature" as const,
          properties: {
            index: i + 1,
            heading_deg: Number((wp.heading * RAD2DEG).toFixed(4)),
            altitude: wp.alt,
            ...(isPoseMode ? { x: wp.localPosition.x, y: wp.localPosition.y } : {}),
          },
          geometry: {
            type: "Point" as const,
            coordinates: [wp.lon, wp.lat, wp.alt],
          },
        }));
        const geojson = { type: "FeatureCollection", features };
        return { content: JSON.stringify(geojson, null, 2), filename: "waypoints.geojson", mime: "application/geo+json" };
      }
      case "csv": {
        const header = "index,latitude,longitude,altitude,heading_deg,x,y";
        const rows = waypoints.map((wp, i) =>
          `${i + 1},${wp.lat.toFixed(10)},${wp.lon.toFixed(10)},${wp.alt.toFixed(3)},${(wp.heading * RAD2DEG).toFixed(4)},${wp.localPosition.x.toFixed(4)},${wp.localPosition.y.toFixed(4)}`
        );
        return { content: [header, ...rows].join("\n") + "\n", filename: "waypoints.csv", mime: "text/csv" };
      }
    }
  };

  const doExport = (format: ExportFormat) => {
    const { content, filename, mime } = generateContent(format);
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    } catch {
      // fallback
    }
    navigator.clipboard.writeText(content).then(
      () => setExportMsg(`Exported ${filename}`),
      () => setExportMsg(`Download: ${filename}`),
    );
    setTimeout(() => setExportMsg(""), 3000);
  };

  const btnStyle: React.CSSProperties = {
    flex: 1,
    padding: "5px 4px",
    backgroundColor: "#3c3c3c",
    border: "1px solid #555",
    color: "#ccc",
    borderRadius: "3px",
    cursor: "pointer",
    fontSize: "11px",
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #444" }}>
      <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#a78bfa" }}>Export Waypoints</h4>
      <div style={{ display: "flex", gap: "4px", marginBottom: "6px" }}>
        <button onClick={() => doExport("yaml")} style={btnStyle}>YAML</button>
        <button onClick={() => doExport("geojson")} style={btnStyle}>GeoJSON</button>
        <button onClick={() => doExport("csv")} style={btnStyle}>CSV</button>
      </div>
      {exportMsg && <div style={{ fontSize: "11px", color: "#8bc34a" }}>{exportMsg}</div>}
      <div style={{ fontSize: "10px", color: "#666", marginTop: "4px" }}>
        YAML matches save_gps_waypoints format
      </div>
    </div>
  );
}
