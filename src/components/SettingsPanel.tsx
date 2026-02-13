import React from "react";
import { Topic } from "@foxglove/extension";
import { Config, LayerType, LayerConfig } from "../types";

// ==================== SETTINGS PANEL ====================

export function SettingsPanel({
  config,
  onConfigChange,
  topics,
  onFilesLoaded,
  localFolderName,
  availableFrames,
  onRecenter,
  onCustomTileFiles,
  customTileFolderName,
  onSnapToRobot,
  onSnapToFixedFrame,
}: {
  config: Config;
  onConfigChange: (c: Partial<Config>) => void;
  topics: readonly Topic[];
  onFilesLoaded: (files: Map<string, string>, folderName: string) => void;
  localFolderName: string;
  availableFrames: string[];
  onRecenter: () => void;
  onCustomTileFiles: (files: FileList) => void;
  customTileFolderName: string;
  onSnapToRobot: () => void;
  onSnapToFixedFrame: () => void;
}) {
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileMap = new Map<string, string>();
    let folder = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const path = (file as any).webkitRelativePath || file.name;
      if (!folder && path.includes("/")) {
        folder = path.split("/")[0]!;
      }
      const blobUrl = URL.createObjectURL(file);
      fileMap.set(path, blobUrl);
    }
    console.log(`[LocalFiles] Loaded ${fileMap.size} files from ${folder}:`, [...fileMap.keys()]);
    onFilesLoaded(fileMap, folder || "unknown");
  };
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
    borderBottom: "1px solid #444",
  };

  return (
    <div style={{ padding: "16px", color: "#fff", fontSize: "13px" }}>
      <h3 style={{ margin: "0 0 16px 0", fontSize: "16px" }}>Settings</h3>

      {/* Map */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>Map</h4>

        <label style={labelStyle}>Map Source</label>
        <select
          value={config.mapSource}
          onChange={(e) => onConfigChange({ mapSource: e.target.value as Config["mapSource"] })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="google">Google 3D Tiles</option>
          <option value="custom">Custom Local Tiles</option>
        </select>

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
            <p style={{ fontSize: "11px", color: "#888", marginBottom: "8px", marginTop: 0 }}>
              Select the folder containing tileset.json and .b3dm files.
              Adjust Lat/Lon to place the model on the globe.
            </p>
            <input
              type="file"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onCustomTileFiles(e.target.files);
                }
              }}
              style={{
                width: "100%",
                padding: "6px",
                backgroundColor: "#3c3c3c",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: "3px",
                fontSize: "12px",
                boxSizing: "border-box",
                cursor: "pointer",
                marginBottom: "6px",
              }}
              {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
            />
            {customTileFolderName && (
              <div style={{ fontSize: "11px", color: "#4caf50", marginBottom: "8px" }}>
                Loaded: <strong>{customTileFolderName}</strong>
              </div>
            )}

            <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
              <button
                onClick={onSnapToRobot}
                title="Sets Lat/Lon/Alt to the current robot GPS position"
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  backgroundColor: "#2d5a27",
                  color: "#fff",
                  border: "1px solid #4a8",
                  borderRadius: "3px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                📍 Snap to Robot
              </button>
              <button
                onClick={onSnapToFixedFrame}
                title="Aligns the model origin (0,0,0) with the ROS map frame"
                style={{
                  flex: 1,
                  padding: "6px 4px",
                  backgroundColor: "#2d3a5a",
                  color: "#fff",
                  border: "1px solid #48a",
                  borderRadius: "3px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                ⚓ Snap to Fixed Frame
              </button>
            </div>

            <h4 style={{ margin: "8px 0 6px 0", fontSize: "12px", color: "#aaa" }}>Georeference Override</h4>

            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 8px", alignItems: "center", marginBottom: "8px" }}>
              <label style={{ fontSize: "11px", color: "#aaa" }}>Latitude</label>
              <input
                type="number"
                step="0.0000001"
                value={config.customLat}
                onChange={(e) => onConfigChange({ customLat: Number(e.target.value) })}
                style={{ ...inputStyle, fontSize: "12px" }}
              />
              <label style={{ fontSize: "11px", color: "#aaa" }}>Longitude</label>
              <input
                type="number"
                step="0.0000001"
                value={config.customLon}
                onChange={(e) => onConfigChange({ customLon: Number(e.target.value) })}
                style={{ ...inputStyle, fontSize: "12px" }}
              />
              <label style={{ fontSize: "11px", color: "#aaa" }}>Altitude (m)</label>
              <input
                type="number"
                step="0.1"
                value={config.customAlt}
                onChange={(e) => onConfigChange({ customAlt: Number(e.target.value) })}
                style={{ ...inputStyle, fontSize: "12px" }}
              />
              <label style={{ fontSize: "11px", color: "#aaa" }}>Heading (°)</label>
              <input
                type="number"
                step="1"
                value={config.customHeading}
                onChange={(e) => onConfigChange({ customHeading: Number(e.target.value) })}
                style={{ ...inputStyle, fontSize: "12px" }}
              />
              <label style={{ fontSize: "11px", color: "#aaa" }}>Scale</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={config.customScale}
                onChange={(e) => onConfigChange({ customScale: Math.max(0.01, Number(e.target.value)) })}
                style={{ ...inputStyle, fontSize: "12px" }}
              />
            </div>
          </>
        )}
      </div>

      {/* GPS */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>GPS</h4>
        <label style={labelStyle}>GPS Topic</label>
        <select
          value={config.gpsTopic}
          onChange={(e) => onConfigChange({ gpsTopic: e.target.value })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="">-- Select --</option>
          {topics
            .filter(
              (t) =>
                t.schemaName?.includes("NavSatFix") ||
                t.schemaName?.includes("sensor_msgs") ||
                t.datatype?.includes("NavSatFix") ||
                t.name.includes("gps") ||
                t.name.includes("fix"),
            )
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          {!topics.some((t) => t.name === config.gpsTopic) && config.gpsTopic && (
            <option value={config.gpsTopic}>{config.gpsTopic}</option>
          )}
        </select>

        <label style={labelStyle}>Follow Mode</label>
        <select
          value={config.followMode}
          onChange={(e) =>
            onConfigChange({ followMode: e.target.value as Config["followMode"] })
          }
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="follow">Follow</option>
          <option value="free">Free</option>
        </select>
      </div>

      {/* Robot Marker */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>
          Robot Marker
        </h4>
        <label
          style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "6px" }}
        >
          <input
            type="checkbox"
            checked={config.showRobotMarker}
            onChange={(e) => onConfigChange({ showRobotMarker: e.target.checked })}
            style={{ marginRight: "8px" }}
          />
          Show GPS Marker
        </label>
        <label style={{ display: "flex", alignItems: "center", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={config.showTrail}
            onChange={(e) => onConfigChange({ showTrail: e.target.checked })}
            style={{ marginRight: "8px" }}
          />
          Show Trail
        </label>
      </div>

      {/* URDF */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>
          URDF Display
        </h4>
        <label
          style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "8px" }}
        >
          <input
            type="checkbox"
            checked={config.showUrdf}
            onChange={(e) => onConfigChange({ showUrdf: e.target.checked })}
            style={{ marginRight: "8px" }}
          />
          Show URDF Robot
        </label>

        <label style={labelStyle}>URDF Topic</label>
        <select
          value={config.urdfTopic}
          onChange={(e) => onConfigChange({ urdfTopic: e.target.value })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="">-- Select --</option>
          {topics
            .filter(
              (t) =>
                t.name.includes("robot_description") ||
                t.schemaName?.includes("String") ||
                t.datatype?.includes("String"),
            )
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          {!topics.some((t) => t.name === config.urdfTopic) && config.urdfTopic && (
            <option value={config.urdfTopic}>{config.urdfTopic}</option>
          )}
        </select>

        <label style={labelStyle}>Joint State Topic</label>
        <select
          value={config.jointStateTopic}
          onChange={(e) => onConfigChange({ jointStateTopic: e.target.value })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="">-- Select --</option>
          {topics
            .filter(
              (t) =>
                t.name.includes("joint") ||
                t.schemaName?.includes("JointState") ||
                t.datatype?.includes("JointState"),
            )
            .map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          {!topics.some((t) => t.name === config.jointStateTopic) &&
            config.jointStateTopic && (
              <option value={config.jointStateTopic}>{config.jointStateTopic}</option>
            )}
        </select>

        <label style={labelStyle}>
          Mesh Server URL{" "}
          <span style={{ color: "#666" }}>(run serve_meshes.py)</span>
        </label>
        <input
          type="text"
          value={config.meshServerUrl}
          onChange={(e) => onConfigChange({ meshServerUrl: e.target.value })}
          placeholder="http://localhost:9090"
          style={{ ...inputStyle, marginBottom: "8px" }}
        />

        <label style={labelStyle}>Frame Prefix (for TF lookup)</label>
        <input
          type="text"
          value={config.framePrefix}
          onChange={(e) => onConfigChange({ framePrefix: e.target.value })}
          placeholder="e.g. simulator_actual/"
          style={{ ...inputStyle, marginBottom: "8px" }}
        />

        <label style={labelStyle}>Altitude Offset (m)</label>
        <input
          type="range"
          min="-10"
          max="10"
          step="0.1"
          value={config.altitudeOffset}
          onChange={(e) => onConfigChange({ altitudeOffset: Number(e.target.value) })}
          style={{ width: "100%", marginBottom: "2px" }}
        />
        <div style={{ fontSize: "11px", color: "#888" }}>{config.altitudeOffset.toFixed(1)}m</div>

        <label style={labelStyle}>URDF Opacity</label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.1"
          value={config.urdfOpacity}
          onChange={(e) => onConfigChange({ urdfOpacity: Number(e.target.value) })}
          style={{ width: "100%", marginBottom: "2px" }}
        />
        <div style={{ fontSize: "11px", color: "#888" }}>{config.urdfOpacity}</div>
      </div>

      {/* TF Frames */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>TF Frames</h4>
        <label
          style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "8px" }}
        >
          <input
            type="checkbox"
            checked={config.showTf}
            onChange={(e) => onConfigChange({ showTf: e.target.checked })}
            style={{ marginRight: "8px" }}
          />
          Show TF Frames
        </label>

        <label style={labelStyle}>Fixed Frame</label>
        <select
          value={config.fixedFrame}
          onChange={(e) => onConfigChange({ fixedFrame: e.target.value })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="">-- Select --</option>
          {availableFrames.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          {!availableFrames.includes(config.fixedFrame) && config.fixedFrame && (
            <option value={config.fixedFrame}>{config.fixedFrame}</option>
          )}
        </select>

        <label style={labelStyle}>Display Frame</label>
        <select
          value={config.displayFrame}
          onChange={(e) => onConfigChange({ displayFrame: e.target.value })}
          style={{ ...inputStyle, marginBottom: "8px" }}
        >
          <option value="">-- Select --</option>
          {availableFrames.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          {!availableFrames.includes(config.displayFrame) && config.displayFrame && (
            <option value={config.displayFrame}>{config.displayFrame}</option>
          )}
        </select>

        <label style={labelStyle}>Frame Axes Size</label>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={config.tfSize}
          onChange={(e) => onConfigChange({ tfSize: Number(e.target.value) })}
          style={{ width: "100%", marginBottom: "2px" }}
        />
        <div style={{ fontSize: "11px", color: "#888" }}>{config.tfSize.toFixed(1)}</div>

        <button
          onClick={onRecenter}
          style={{
            width: "100%",
            padding: "6px",
            marginTop: "8px",
            backgroundColor: "#4a4a4a",
            color: "#fff",
            border: "1px solid #666",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Re-center Map
        </button>
      </div>

      {/* Local Mesh Loader */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>
          Local Mesh Loader
        </h4>
        <p style={{ fontSize: "11px", color: "#888", marginBottom: "8px" }}>
          Select folder containing meshes to load directly from disk. You may need to reload Foxglove using CRTL + R
        </p>
        <input
          type="file"
          onChange={handleFileSelect}
          style={{
            width: "100%",
            padding: "6px",
            backgroundColor: "#3c3c3c",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: "3px",
            fontSize: "12px",
            boxSizing: "border-box",
            cursor: "pointer",
          }}
          {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
        />
        {localFolderName > "" && (
          <div style={{ fontSize: "11px", color: "#4caf50", marginTop: "4px" }}>
            Loaded: <strong>{localFolderName}</strong>
          </div>
        )}
      </div>

      {/* Visualization Layers */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#6c9ef8" }}>
          Visualization Layers
        </h4>

        {config.layers.map((layer) => (
          <div
            key={layer.id}
            style={{
              backgroundColor: "#383838",
              borderRadius: "4px",
              padding: "8px",
              marginBottom: "6px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", color: "#6c9ef8", fontWeight: "bold", textTransform: "uppercase" }}>
                {layer.type}
              </span>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  onClick={() =>
                    onConfigChange({
                      layers: config.layers.map((l) =>
                        l.id === layer.id ? { ...l, visible: !l.visible } : l,
                      ),
                    })
                  }
                  style={{
                    background: "transparent",
                    border: "1px solid #555",
                    borderRadius: "3px",
                    color: layer.visible ? "#4caf50" : "#888",
                    cursor: "pointer",
                    padding: "2px 6px",
                    fontSize: "11px",
                  }}
                >
                  {layer.visible ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() =>
                    onConfigChange({
                      layers: config.layers.filter((l) => l.id !== layer.id),
                    })
                  }
                  style={{
                    background: "transparent",
                    border: "1px solid #555",
                    borderRadius: "3px",
                    color: "#f44336",
                    cursor: "pointer",
                    padding: "2px 6px",
                    fontSize: "11px",
                  }}
                >
                  Del
                </button>
              </div>
            </div>

            <label style={labelStyle}>Topic</label>
            <input
              type="text"
              value={layer.topic}
              onChange={(e) =>
                onConfigChange({
                  layers: config.layers.map((l) =>
                    l.id === layer.id ? { ...l, topic: e.target.value } : l,
                  ),
                })
              }
              placeholder="/topic_name"
              style={{ ...inputStyle, marginBottom: "6px" }}
            />

            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0 }}>Color</label>
              <input
                type="color"
                value={layer.color}
                onChange={(e) =>
                  onConfigChange({
                    layers: config.layers.map((l) =>
                      l.id === layer.id ? { ...l, color: e.target.value } : l,
                    ),
                  })
                }
                style={{ width: "32px", height: "24px", border: "none", cursor: "pointer", backgroundColor: "transparent" }}
              />
              <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0, marginLeft: "8px" }}>Opacity</label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={layer.opacity}
                onChange={(e) =>
                  onConfigChange({
                    layers: config.layers.map((l) =>
                      l.id === layer.id ? { ...l, opacity: Number(e.target.value) } : l,
                    ),
                  })
                }
                style={{ flex: 1 }}
              />
            </div>

            {/* Buffer size (for navsat and path) */}
            {(layer.type === "navsat" || layer.type === "path") && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <label style={{ ...labelStyle, flex: "0 0 auto", marginBottom: 0 }}>Buffer</label>
                <input
                  type="number"
                  min="10"
                  max="100000"
                  value={layer.buffer || 1000}
                  onChange={(e) =>
                    onConfigChange({
                      layers: config.layers.map((l) =>
                        l.id === layer.id ? { ...l, buffer: Math.max(10, Number(e.target.value) || 1000) } : l,
                      ),
                    })
                  }
                  style={{ ...inputStyle, width: "80px", flex: "0 0 auto" }}
                />
                <span style={{ fontSize: "11px", color: "#888" }}>points</span>
              </div>
            )}
          </div>
        ))}

        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={() => {
              const typeSelect = document.getElementById("layer-type-select") as HTMLSelectElement;
              const ltype = (typeSelect?.value || "path") as LayerType;
              const colorMap: Record<LayerType, string> = { path: "#00ff00", odometry: "#ff8800", navsat: "#ff00ff" };
              const newLayer: LayerConfig = {
                id: Date.now().toString(36),
                type: ltype,
                topic: "",
                color: colorMap[ltype] || "#00ff00",
                opacity: 1,
                visible: true,
                buffer: 1000,
              };
              onConfigChange({ layers: [...config.layers, newLayer] });
            }}
            style={{
              padding: "6px 16px",
              backgroundColor: "#4a4a4a",
              color: "#fff",
              border: "1px solid #666",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Add
          </button>
          <select
            id="layer-type-select"
            style={{ ...inputStyle, flex: 1 }}
            defaultValue="navsat"
          >
            <option value="path">Path</option>
            <option value="odometry">Odometry</option>
            <option value="navsat">NavSat</option>
          </select>
          <button
            onClick={() => {
              if (config.layers.length > 0) {
                onConfigChange({ layers: config.layers.slice(0, -1) });
              }
            }}
            style={{
              padding: "6px 16px",
              backgroundColor: "#4a4a4a",
              color: "#f44336",
              border: "1px solid #666",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
