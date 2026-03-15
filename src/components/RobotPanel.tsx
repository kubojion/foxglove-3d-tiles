import React, { useState } from "react";
import { Topic } from "@foxglove/extension";
import { Config } from "../types";
import { TopicSelect } from "./SettingsPanel";
import { RobotIcon } from "./Icons";

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

// ==================== ROBOT PANEL ====================

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
};

export function RobotPanel({
  config,
  onConfigChange,
  topics,
  onFilesLoaded,
  localFolderName,
  availableFrames,
  onUrdfFileLoaded,
  lastMeshFolderName,
}: {
  config: Config;
  onConfigChange: (c: Partial<Config>) => void;
  topics: readonly Topic[];
  onFilesLoaded: (files: Map<string, string>, folderName: string) => void;
  localFolderName: string;
  availableFrames: string[];
  onUrdfFileLoaded: (xml: string, fileName: string) => void;
  lastMeshFolderName: string;
}) {
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileMap = new Map<string, string>();
    let folder = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const path = (file as any).webkitRelativePath || file.name;
      if (!folder && path.includes("/")) folder = path.split("/")[0]!;
      const blobUrl = URL.createObjectURL(file);
      fileMap.set(path, blobUrl);
    }
    onFilesLoaded(fileMap, folder || "unknown");
  };

  const handleUrdfFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const xml = reader.result as string;
      if (xml) {
        onUrdfFileLoaded(xml, file.name);
      }
    };
    reader.readAsText(file);
  };

  // Toggle button builder
  const toggleBtn = (
    label: string,
    active: boolean,
    onClick: () => void,
    position: "left" | "right",
  ): React.ReactElement => {
    const radius = position === "left" ? "3px 0 0 3px" : "0 3px 3px 0";
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

  // Mesh folder status
  const meshStatusChip = localFolderName
    ? <span style={{ fontSize: "11px", color: "#8bc34a", marginLeft: "6px" }}>({localFolderName})</span>
    : lastMeshFolderName
      ? <span style={{ fontSize: "11px", color: "#ff9800", marginLeft: "6px" }}>(reload: {lastMeshFolderName})</span>
      : null;

  return (
    <div style={{ padding: "8px 0", color: "#fff", fontSize: "13px" }}>
      <h3 style={{ margin: "12px 16px 8px", fontSize: "15px", color: "#ddd", display: "flex", alignItems: "center" }}>
        <RobotIcon size={18} /> Robot
      </h3>

      {/* ====== URDF DISPLAY ====== */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 4px 0", fontSize: "13px", color: "#a78bfa", display: "flex", alignItems: "center" }}>
          URDF Robot Model
          <InfoIcon tooltip="The URDF defines the robot structure. Mesh files (.stl/.dae) provide the 3D shape of each link." />
        </h4>

        <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "8px", marginTop: "6px" }}>
          <input type="checkbox" checked={config.showUrdf}
            onChange={(e) => onConfigChange({ showUrdf: e.target.checked })}
            style={{ marginRight: "8px" }} />
          Show Robot Model
        </label>

        <label style={labelStyle}>URDF Source</label>
        <div style={{ display: "flex", marginBottom: "8px" }}>
          {toggleBtn("Topic", config.urdfSourceMode === "topic", () => onConfigChange({ urdfSourceMode: "topic" }), "left")}
          {toggleBtn("File", config.urdfSourceMode === "file", () => onConfigChange({ urdfSourceMode: "file" }), "right")}
        </div>

        {config.urdfSourceMode === "topic" && (
          <>
            <label style={labelStyle}>Robot Description Topic (std_msgs/String)</label>
            <div style={{ marginBottom: "8px" }}>
              <TopicSelect
                value={config.urdfTopic}
                onChange={(v) => onConfigChange({ urdfTopic: v })}
                topics={topics}
                filter={(t) =>
                  !!(t.schemaName?.includes("String") ||
                  t.datatype?.includes("String") ||
                  t.name.includes("robot_description"))
                }
                inputStyle={inputStyle}
              />
            </div>
          </>
        )}

        {config.urdfSourceMode === "file" && (
          <>
            <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
              URDF File (.urdf / .xacro)
              <InfoIcon tooltip="Select a URDF file from your computer. Must be re-selected after each Foxglove reload." />
            </label>
            <input
              type="file"
              accept=".urdf,.xacro,.xml"
              onChange={handleUrdfFileSelect}
              style={{
                width: "100%", padding: "6px", backgroundColor: "#3c3c3c",
                color: "#fff", border: "1px solid #555", borderRadius: "3px",
                fontSize: "12px", boxSizing: "border-box", cursor: "pointer", marginTop: "4px",
                marginBottom: "8px",
              }}
            />
          </>
        )}

        <label style={labelStyle}>Joint State Topic (sensor_msgs/JointState)</label>
        <div style={{ marginBottom: "8px" }}>
          <TopicSelect
            value={config.jointStateTopic}
            onChange={(v) => onConfigChange({ jointStateTopic: v })}
            topics={topics}
            filter={(t) =>
              !!(t.name.includes("joint") ||
              t.schemaName?.includes("JointState") ||
              t.datatype?.includes("JointState"))
            }
            inputStyle={inputStyle}
          />
        </div>

        <label style={{ ...labelStyle, display: "flex", alignItems: "center" }}>
          Mesh Files Folder
          {meshStatusChip}
          <InfoIcon tooltip="Load the folder containing .stl/.dae mesh files. Must be re-selected after each Foxglove reload (browser security)." />
        </label>
        <input
          type="file"
          onChange={handleFileSelect}
          style={{
            width: "100%", padding: "6px", backgroundColor: "#3c3c3c",
            color: "#fff", border: "1px solid #555", borderRadius: "3px",
            fontSize: "12px", boxSizing: "border-box", cursor: "pointer", marginTop: "4px",
          }}
          {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
        />

        <label style={{ ...labelStyle, marginTop: "8px" }}>Opacity</label>
        <input
          type="range" min="0.1" max="1" step="0.1"
          value={config.urdfOpacity}
          onChange={(e) => onConfigChange({ urdfOpacity: Number(e.target.value) })}
          style={{ width: "100%", marginBottom: "2px" }}
        />
        <div style={{ fontSize: "11px", color: "#888" }}>{config.urdfOpacity}</div>
      </div>

      {/* ====== TF FRAMES ====== */}
      <div style={sectionStyle}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "13px", color: "#a78bfa" }}>TF Frames</h4>
        <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "6px" }}>
          <input type="checkbox" checked={config.showTf}
            onChange={(e) => onConfigChange({ showTf: e.target.checked })}
            style={{ marginRight: "8px" }} />
          Show TF Frames
        </label>
        <label style={{ display: "flex", alignItems: "center", fontSize: "13px", marginBottom: "8px" }}>
          <input type="checkbox" checked={config.showTfLabels}
            onChange={(e) => onConfigChange({ showTfLabels: e.target.checked })}
            style={{ marginRight: "8px" }} />
          Show Frame Names
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
          {config.fixedFrame && !availableFrames.includes(config.fixedFrame) && (
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
          {config.displayFrame && !availableFrames.includes(config.displayFrame) && (
            <option value={config.displayFrame}>{config.displayFrame}</option>
          )}
        </select>

        <label style={labelStyle}>Frame Prefix</label>
        <input
          type="text"
          value={config.framePrefix}
          onChange={(e) => onConfigChange({ framePrefix: e.target.value })}
          placeholder="e.g. simulator_actual/"
          style={{ ...inputStyle, marginBottom: "8px" }}
        />

        <label style={labelStyle}>Frame Axes Size</label>
        <input
          type="range" min="0.1" max="5" step="0.1"
          value={config.tfSize}
          onChange={(e) => onConfigChange({ tfSize: Number(e.target.value) })}
          style={{ width: "100%", marginBottom: "2px" }}
        />
        <div style={{ fontSize: "11px", color: "#888" }}>{config.tfSize.toFixed(1)}</div>
      </div>
    </div>
  );
}
