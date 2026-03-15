import React, { useState } from "react";
import { Topic } from "@foxglove/extension";
import { Config } from "../types";
import { SettingsIcon } from "./Icons";

// ==================== TOOLTIP COMPONENT ====================
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
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(25, 25, 25, 0.97)",
          color: "#ccc",
          border: "1px solid #555",
          borderRadius: "6px",
          padding: "10px 14px",
          fontSize: "12px",
          lineHeight: "1.5",
          whiteSpace: "normal",
          width: "260px",
          zIndex: 3000,
          pointerEvents: "none",
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          textAlign: "center",
        }}>
          {tooltip}
        </div>
      )}
    </span>
  );
}

// ==================== TOPIC SELECT WITH MANUAL INPUT ====================
export function TopicSelect({
  value,
  onChange,
  topics,
  filter,
  inputStyle,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  topics: readonly Topic[];
  filter?: (t: Topic) => boolean;
  inputStyle: React.CSSProperties;
  placeholder?: string;
}) {
  const [manualMode, setManualMode] = useState(false);
  const filtered = filter ? topics.filter(filter) : [...topics];
  return (
    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
      {manualMode ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "/topic_name"}
          style={{ ...inputStyle, flex: 1 }}
        />
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        >
          <option value="">-- Select --</option>
          {filtered.map((t) => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
          {value && !topics.some((t) => t.name === value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      )}
      <button
        onClick={() => setManualMode(!manualMode)}
        title={manualMode ? "Show dropdown" : "Type manually"}
        style={{
          padding: "4px 6px", fontSize: "11px", cursor: "pointer",
          backgroundColor: manualMode ? "#6f3be8" : "#4a4a4a",
          color: manualMode ? "#fff" : "#ccc",
          border: "1px solid " + (manualMode ? "#8b5cf6" : "#666"),
          borderRadius: "3px", flexShrink: 0,
        }}
      >
        ✎
      </button>
    </div>
  );
}

// ==================== SETTINGS PANEL ====================

export function SettingsPanel({
  config,
  onConfigChange,
  topics,
  onCustomTileFiles,
  customTileFolderName,
  onSnapToRobot,
  onSnapToFixedFrame,
}: {
  config: Config;
  onConfigChange: (c: Partial<Config>) => void;
  topics: readonly Topic[];
  onCustomTileFiles: (files: FileList) => void;
  customTileFolderName: string;
  onSnapToRobot: () => void;
  onSnapToFixedFrame: () => void;
}) {
  const [exportMsg, setExportMsg] = useState("");

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
    marginBottom: "16px",
    paddingBottom: "12px",
    paddingLeft: "16px",
    paddingRight: "16px",
    borderBottom: "1px solid #444",
  };

  // Shared toggle button builder
  const toggleBtn = (
    label: string,
    active: boolean,
    onClick: () => void,
    position: "left" | "right" | "middle",
  ): React.ReactElement => {
    const radius =
      position === "left" ? "3px 0 0 3px" :
      position === "right" ? "0 3px 3px 0" : "0";
    return (
      <button
        key={label}
        onClick={onClick}
        style={{
          flex: 1, padding: "5px 0", fontSize: "12px",
          fontWeight: active ? "bold" : "normal",
          backgroundColor: active ? "#6f3be8" : "#3c3c3c",
          color: active ? "#fff" : "#aaa",
          border: "1px solid " + (active ? "#8b5cf6" : "#555"),
          borderRadius: radius, cursor: "pointer",
        }}
      >
        {label}
      </button>
    );
  };

  // Shared small action button
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

  return (
    <div style={{ padding: "8px 0", color: "#fff", fontSize: "13px" }}>
      <h3 style={{ margin: "12px 16px 8px", fontSize: "15px", color: "#ddd", display: "flex", alignItems: "center" }}>
        <SettingsIcon size={18} /> Settings
      </h3>

      {/* ====== MAP TILES ====== */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#a78bfa" }}>Map Tiles</h4>

        <label style={labelStyle}>Map Source</label>
        <select
          value={config.mapSource}
          onChange={(e) => onConfigChange({ mapSource: e.target.value as Config["mapSource"] })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="google">Google Photorealistic 3D Tiles</option>
          <option value="osm">OpenStreetMap 2D (Experimental)</option>
          <option value="custom">Custom Local Tiles (Experimental)</option>
        </select>

        {config.mapSource === "osm" && (
          <>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
              Zoom Level
              <InfoIcon tooltip="OSM tile zoom level. 16–17 for overview, 18–19 for detail. Tiles load from tile.openstreetmap.org." />
            </label>
            <input
              type="range" min="14" max="19" step="1"
              value={config.osmZoom}
              onChange={(e) => onConfigChange({ osmZoom: Number(e.target.value) })}
              style={{ width: "100%", marginBottom: "2px" }}
            />
            <div style={{ fontSize: "11px", color: "#888", marginBottom: "8px" }}>Zoom {config.osmZoom}</div>

            <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
              Robot Height Offset (m)
              <InfoIcon tooltip="Lifts the URDF robot model above the map/grid. Adjust so the robot sits at the right height." />
            </label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="range" min="0" max="3" step="0.1"
                value={config.osmRobotHeight}
                onChange={(e) => onConfigChange({ osmRobotHeight: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <input
                type="number" step="0.1"
                value={config.osmRobotHeight}
                onChange={(e) => onConfigChange({ osmRobotHeight: Number(e.target.value) || 0 })}
                style={{ ...inputStyle, width: "60px", flex: "0 0 auto" }}
              />
            </div>
          </>
        )}

        {config.mapSource === "google" && (
          <>
            <label style={labelStyle}>Google Maps API Key</label>
            <input
              type="password"
              value={config.googleApiKey}
              onChange={(e) => onConfigChange({ googleApiKey: e.target.value })}
              placeholder="Enter API Key..."
              style={{ ...inputStyle, marginBottom: "8px" }}
            />
          </>
        )}

        {config.mapSource === "custom" && (
          <>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
              Custom Tile Folder
              <InfoIcon tooltip="Select the folder containing tileset.json and .b3dm files." />
            </label>
            <input
              type="file"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) onCustomTileFiles(e.target.files);
              }}
              style={{
                width: "100%", padding: "6px", backgroundColor: "#3c3c3c",
                color: "#fff", border: "1px solid #555", borderRadius: "3px",
                fontSize: "12px", boxSizing: "border-box", cursor: "pointer", marginBottom: "6px",
              }}
              {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
            />
            {customTileFolderName && (
              <div style={{ fontSize: "11px", color: "#8bc34a", marginBottom: "8px" }}>
                Loaded: <strong>{customTileFolderName}</strong>
              </div>
            )}

            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              {actionBtn("Snap to Robot", onSnapToRobot)}
              {actionBtn("Snap to Fixed Frame", onSnapToFixedFrame)}
            </div>

            <h4 style={{ margin: "8px 0 6px 0", fontSize: "12px", color: "#aaa" }}>Georeference</h4>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#ccc", marginBottom: "8px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={config.useNativeGeoref}
                onChange={(e) => onConfigChange({ useNativeGeoref: e.target.checked })}
              />
              Use Native Georeference (GPS)
              <InfoIcon tooltip="Keep the tileset's built-in ECEF transform so it snaps to its real-world GPS location (like Google 3D Tiles). Disable to manually position with the sliders below." />
            </label>

            {!config.useNativeGeoref && (
              <>
                <h4 style={{ margin: "8px 0 6px 0", fontSize: "12px", color: "#aaa" }}>Manual Placement</h4>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 8px", alignItems: "center", marginBottom: "8px" }}>
                  <label style={{ fontSize: "11px", color: "#aaa" }}>Latitude</label>
                  <input type="number" step="0.0000001" value={config.customLat}
                    onChange={(e) => onConfigChange({ customLat: Number(e.target.value) })} style={{ ...inputStyle, fontSize: "12px" }} />
                  <label style={{ fontSize: "11px", color: "#aaa" }}>Longitude</label>
                  <input type="number" step="0.0000001" value={config.customLon}
                    onChange={(e) => onConfigChange({ customLon: Number(e.target.value) })} style={{ ...inputStyle, fontSize: "12px" }} />
                  <label style={{ fontSize: "11px", color: "#aaa" }}>Altitude (m)</label>
                  <input type="number" step="0.1" value={config.customAlt}
                    onChange={(e) => onConfigChange({ customAlt: Number(e.target.value) })} style={{ ...inputStyle, fontSize: "12px" }} />
                  <label style={{ fontSize: "11px", color: "#aaa" }}>Heading</label>
                  <input type="number" step="1" value={config.customHeading}
                    onChange={(e) => onConfigChange({ customHeading: Number(e.target.value) })} style={{ ...inputStyle, fontSize: "12px" }} />
                  <label style={{ fontSize: "11px", color: "#aaa" }}>Scale</label>
                  <input type="number" step="0.01" min="0.01" value={config.customScale}
                    onChange={(e) => onConfigChange({ customScale: Math.max(0.01, Number(e.target.value)) })} style={{ ...inputStyle, fontSize: "12px" }} />
                </div>
              </>
            )}
          </>
        )}

        {config.mapSource !== "osm" && (
          <>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
              Rendering Quality
              <InfoIcon tooltip="Adjusts 3D tile detail level (errorTarget). Higher = sharper but uses more bandwidth. Note: Google's public 3D Tiles API does not serve the highest LOD available in Google Earth." />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "#888", whiteSpace: "nowrap" }}>Low</span>
              <input
                type="range" min="1" max="15" step="1"
                value={21 - config.tileQuality}
                onChange={(e) => onConfigChange({ tileQuality: 21 - Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: "11px", color: "#888", whiteSpace: "nowrap" }}>High</span>
            </div>
            <div style={{ fontSize: "11px", color: "#888", marginBottom: "8px", textAlign: "center" }}>
              {config.tileQuality <= 8 ? "High" : config.tileQuality <= 14 ? "Medium" : "Low"}
            </div>

            <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
              Altitude Offset (m)
              <InfoIcon tooltip="Shift all overlays up/down relative to 3D tiles" />
            </label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="range" min="-50" max="50" step="0.1"
                value={config.altitudeOffset}
                onChange={(e) => onConfigChange({ altitudeOffset: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <input
                type="number" step="0.1"
                value={config.altitudeOffset}
                onChange={(e) => onConfigChange({ altitudeOffset: Number(e.target.value) || 0 })}
                style={{ ...inputStyle, width: "70px", flex: "0 0 auto" }}
              />
            </div>
          </>
        )}
      </div>

      {/* ====== REFERENCE GPS ====== */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 4px 0", fontSize: "13px", color: "#a78bfa", display: "flex", alignItems: "center" }}>
          Reference GPS
          <InfoIcon tooltip="Anchors the 3D map to the robot. Similar to the Satellite Map topic in RViz." />
        </h4>

        <label style={{ ...labelStyle, marginTop: "6px" }}>GPS Topic (sensor_msgs/NavSatFix)</label>
        <div style={{ marginBottom: "8px" }}>
          <TopicSelect
            value={config.gpsTopic}
            onChange={(v) => onConfigChange({ gpsTopic: v })}
            topics={topics}
            filter={(t) =>
              !!(t.schemaName?.includes("NavSatFix") ||
              t.schemaName?.includes("sensor_msgs") ||
              t.datatype?.includes("NavSatFix") ||
              t.name.includes("gps") || t.name.includes("fix"))
            }
            inputStyle={inputStyle}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "6px" }}>
          <input type="checkbox" checked={config.showRobotMarker}
            onChange={(e) => onConfigChange({ showRobotMarker: e.target.checked })}
            style={{ marginRight: "8px" }} />
          Show GPS Marker
        </label>

        <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "6px" }}>
          <input type="checkbox" checked={config.showTrail}
            onChange={(e) => onConfigChange({ showTrail: e.target.checked })}
            style={{ marginRight: "8px" }} />
          Show Trail
        </label>

        {config.showTrail && (
          <>
            <label style={labelStyle}>Trail Length (points)</label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
              <input
                type="range" min="50" max="10000" step="50"
                value={config.trailLength}
                onChange={(e) => onConfigChange({ trailLength: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <input
                type="number" min="50" max="100000"
                value={config.trailLength}
                onChange={(e) => onConfigChange({ trailLength: Math.max(50, Number(e.target.value) || 500) })}
                style={{ ...inputStyle, width: "70px", flex: "0 0 auto" }}
              />
            </div>
          </>
        )}

        <label style={labelStyle}>Camera Mode</label>
        <div style={{ display: "flex", marginBottom: "4px" }}>
          {toggleBtn("Follow Robot", config.followMode === "follow", () => onConfigChange({ followMode: "follow" }), "left")}
          {toggleBtn("Free Camera", config.followMode === "free", () => onConfigChange({ followMode: "free" }), "right")}
        </div>
      </div>

      {/* ====== CONFIG PRESETS ====== */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#a78bfa" }}>Config Presets</h4>
        <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          {actionBtn("Export", () => {
            // Exclude sensitive credentials from exported config
            const { googleApiKey: _key, ...safeConfig } = config;
            const json = JSON.stringify(safeConfig, null, 2);
            // Try download via <a> tag
            try {
              const blob = new Blob([json], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "foxglove-3d-tiles-config.json";
              a.style.display = "none";
              document.body.appendChild(a);
              a.click();
              setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }, 200);
            } catch {
              // ignore download error
            }
            // Also copy to clipboard as fallback (works in sandboxed envs)
            navigator.clipboard.writeText(json).then(
              () => { setExportMsg("Copied to clipboard!"); },
              () => { setExportMsg("Download triggered"); },
            );
            setTimeout(() => setExportMsg(""), 3000);
          })}
          <label style={{
            padding: "4px 10px", fontSize: "11px", cursor: "pointer",
            backgroundColor: "#4a4a4a", color: "#ccc",
            border: "1px solid #666", borderRadius: "3px",
            textAlign: "center", display: "inline-flex", alignItems: "center",
          }}>
            Import
            <input
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const imported = JSON.parse(reader.result as string);
                    if (typeof imported === "object" && imported !== null) {
                      onConfigChange(imported);
                    }
                  } catch {
                    alert("Invalid config file.");
                  }
                };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
          </label>
          {exportMsg && <span style={{ fontSize: "11px", color: "#8bc34a", alignSelf: "center" }}>{exportMsg}</span>}
        </div>
        <div style={{ fontSize: "11px", color: "#888" }}>Save or load all settings as a JSON file.</div>
      </div>
    </div>
  );
}
