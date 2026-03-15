import React from "react";

// Clean inline SVG icons for toolbar buttons.
// These replace emojis for a consistent, professional look.

const iconStyle: React.CSSProperties = {
  display: "inline-block",
  verticalAlign: "middle",
  marginRight: "4px",
  flexShrink: 0,
};

export function CenterIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

export function RulerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <path d="M2 18 L18 2 L22 6 L6 22 Z" />
      <line x1="7.5" y1="14.5" x2="9.5" y2="12.5" />
      <line x1="10.5" y1="11.5" x2="12.5" y2="9.5" />
      <line x1="13.5" y1="8.5" x2="15.5" y2="6.5" />
    </svg>
  );
}

export function WaypointIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"
      style={iconStyle}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z" />
    </svg>
  );
}

export function SettingsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function LayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyle}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

export function RobotIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" stroke="none"
      style={iconStyle}>
      <path d="M30.663 14.423l-3.593-0.663c-0.221-0.426-0.597-0.774-1.084-0.95-0.061-0.022-0.123-0.041-0.185-0.057l-4.024-7.963c0.382-0.767 0.431-1.684 0.053-2.516-0.672-1.482-2.441-2.128-3.951-1.443l-15.015 6.125c-1.829 0.83-2.652 2.958-1.838 4.753 0.347 0.765 0.935 1.345 1.638 1.696l5.468 13.482 0.232 0.589c-1.059 0.98-1.722 2.382-1.722 3.939h10.734c0-2.964-2.403-5.367-5.367-5.367-0.010 0-0.019 0-0.029 0l-0.383-1.051 0.060 0.015-0.105-0.138-4.383-12.042-0.004-0.051 12.066-6.041 4.238 7.212c-0.006 0.016-0.013 0.031-0.018 0.047-0.033 0.092-0.059 0.185-0.078 0.279l-3.378 2.057 1.136 1.035 1.646 3.513 1.68 0.313-0.683-4.858 0.258-0.155c0.175 0.149 0.38 0.27 0.609 0.353 0.87 0.315 1.817-0.018 2.313-0.751l1.231 4.724 1.468-0.874 0.294-3.442 0.139 0.025 0.579-1.792z" />
    </svg>
  );
}