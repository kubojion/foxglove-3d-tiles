# Foxglove 3D Tiles

A [Foxglove](https://foxglove.dev/) extension for visualising robots in real-world geospatial context and interactively placing navigation goals on the map. It renders Google Photorealistic 3D Tiles or local 3D Tiles alongside URDF, TF, GPS, paths, markers, costmaps, and drag-to-set waypoint publishing for `/clicked_point` and `/goal_pose`.

Designed especially for field robotics and Nav2-style workflows: click directly on the real-world map, drag to set heading, and publish either geospatial clicked points or local-frame goal poses without switching between separate tools.


Built with [Three.js](https://threejs.org/), [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) (NASA JPL), and [urdf-loader](https://github.com/gkjohnson/urdf-loader). No Cesium dependency.

<br>
<div align="center">
  <img src="https://github.com/user-attachments/assets/28af0498-c98b-443a-af9d-6a0615152515" width="100%">
  <br><br>
  <em>Foxglove 3D Tiles</em>
</div>
<br>


---

## Why This Extension?

| Capability | RViz2 | MapViz | **This Extension** |
| :--- | :---: | :---: | :---: |
| **Full 3D URDF & TF Rendering** | Yes | No | **Yes** |
| **Geospatial Maps (Satellite/OSM)** | via Plugins (2D) | Yes (2D) | **Yes (3D & 2D)** |
| **Photorealistic 3D Topography (OGC Tiles)** | No | No | **Yes** |
| **Terrain Elevation Awareness** | Flat Plane | Flat Plane | **True 3D** |
| **Offline Custom Drone Maps (Local Tiles)** | No | No | **Yes** |
| **Publish Interactive 3D Waypoints** | No | /clicked_point only | **Yes (Drag-to-set /goal_pose)** |


### Key Features

- **Interactive Nav2 / GPS waypoint placement** - click directly on the map to publish `geometry_msgs/PointStamped` or `geometry_msgs/PoseStamped`. Built for workflows such as `/clicked_point`, `/goal_pose`, GPS waypoint tools, and geospatial robot testing.
- **Drag-to-set heading** - after clicking a waypoint location, drag to visually set the orientation. The heading arrow updates in real-time and publishes a ready-to-use quaternion in `PoseStamped` mode.
- **URDF robot model on photorealistic tiles** - see your robot on a real-world 3D map, driven by `/tf` and `/joint_states`.
- **Measurement tool** - click two points on the map to measure the straight-line distance in meters.
- **Config presets** - export your full panel configuration as JSON. Import on another machine or share with your team. The API key is excluded from exports for security. 
---

## Features

### Map & Tiles
- Google Photorealistic 3D Tiles (primary)
- OpenStreetMap 2D (experimental)
- Custom local 3D Tiles (experimental)
- Tile quality slider (LOD control)

### Robot Visualization
- URDF robot model - load from topic (`std_msgs/String`) or local `.urdf` file
- Joint state updates from `sensor_msgs/JointState`
- Local mesh folder loading for URDF mesh resources
- Configurable robot opacity and frame selection
- TF frame visualization - render the entire TF tree as 3D axes on the map
- Robot marker (red sphere) with breadcrumb trail

### Overlay Layers
Add unlimited overlay layers from the Layers panel:

| Layer Type | Message Type | Description |
|---|---|---|
| **Path** | `nav_msgs/Path` | Line strip from pose array |
| **Odometry** | `nav_msgs/Odometry` | Arrow at each pose |
| **NavSat** | `sensor_msgs/NavSatFix` | Dot buffer on the globe |
| **Marker** | `visualization_msgs/Marker` or `MarkerArray` | 11 marker types (see below) |
| **Costmap** | `nav_msgs/OccupancyGrid` | Nav2 costmap overlay |

#### Supported Marker Types
Arrow, Cube, Sphere, Cylinder, Line Strip, Line List, Cube List, Sphere List, Points, Text, Triangle List

### Waypoint Publishing
- Click anywhere on the 3D map to place a waypoint
- Drag to set heading (PoseStamped mode)
- Publish waypoints with presets for `/clicked_point` and `/goal_pose`
- `/clicked_point` → `PointStamped` with GPS coordinates (lon, lat, alt) in `wgs84` frame
- `/goal_pose` → `PoseStamped` with local coordinates (x, y) and orientation in `map` frame

<br>
<div align="center">
  <img src="https://github.com/user-attachments/assets/bdfd3baa-1595-4738-be05-fac0ca5ea105" width="80%">
  <br><br>
  <em>Interactive waypoint placement with drag-to-set heading</em>
</div>
<br>

### Camera & Navigation
- Globe controls (orbit, pan, zoom) with Google 3D Tiles
- Map controls (top-down pan/zoom) with OSM 2D
- Follow mode (camera tracks robot)
- Free mode (manual camera)
- Hold **Shift** to temporarily re-enable camera movement during waypoint/measure mode
- Grid overlay with configurable size, spacing, and height offset

### Settings & Config
- Persistent settings saved across sessions
- Config export/import as JSON (presets - API key excluded for security)
- Per-layer color, opacity, visibility, and topic controls
- All topics configurable - no hardcoded topic names

---

## Prerequisites

### Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Map Tiles API**
3. **Enable billing** on the project - the Map Tiles API requires an active billing account
4. Create an API key under **Credentials**

A valid API key is only required when using Google 3D Tiles. OSM and custom local tilesets do not require an API key.

> **Note for EEA users:** The Google Map Tiles API has different terms and may have different functionality for billing accounts in the [European Economic Area (EEA)](https://developers.google.com/maps/comms/eea/faq). If your Google Cloud billing address is in the EEA, review Google's [EEA-specific terms](https://cloud.google.com/terms/maps-platform/eea) before use.

---

## Installation

```bash
cd foxglove-3d-tiles
npm install
npm run local-install
```

Restart Foxglove, then add the **"3D Tiles"** panel from the panel list.

### From Package

Download the `.foxe` file from the [Releases](https://github.com/kubojion/foxglove-3d-tiles/releases) page and install it in Foxglove via **Settings → Extensions → Install from file**.

---

## Usage

1. Open the **Settings** panel (gear icon)
2. Select a map source - **Google Photorealistic 3D Tiles** is the default
3. Enter your Google Maps API key
4. Set the GPS topic (e.g. `/gps/fix`)
5. Play a ROS 2 bag or connect to live data
6. Use the **Layers** panel to add Path, Odometry, NavSat, Marker, or Costmap overlays
7. Use the **Robot** panel to configure URDF, joint states, and TF
8. Use the **Waypoint** panel to publish clicked points or goal poses

### Waypoint Placement Workflow

1. Open the Waypoint panel and select a topic (e.g. `/goal_pose`)
2. Click **Start Placing**
3. Click on the 3D map - for PoseStamped topics, drag to set heading
4. The message is published instantly
5. Hold **Shift** while placing to temporarily pan/orbit the camera

---

## ROS 2 Topics

| Topic | Type | Purpose |
|---|---|---|
| GPS topic (configurable) | `sensor_msgs/NavSatFix` | Robot GPS position |
| URDF topic (configurable) | `std_msgs/String` | Robot description XML |
| Joint state topic (configurable) | `sensor_msgs/JointState` | Joint positions |
| `/tf` | `tf2_msgs/TFMessage` | Transform tree |
| `/tf_static` | `tf2_msgs/TFMessage` | Static transforms |
| Layer topics (configurable) | Various | See Overlay Layers table |
| Waypoint topic (configurable) | `PointStamped` / `PoseStamped` | Published by the user |

---

### Technical Details

- **Three.js** v0.182 for WebGL rendering
- **3d-tiles-renderer** v0.4.22 (NASA JPL) for OGC 3D Tiles + GlobeControls
- **urdf-loader** v0.12 for URDF parsing and rendering
- **Foxglove Extension SDK** v2.45
- Fully bundled into a single `extension.js` - no external CDN, workers, or WASM
- Fully Foxglove CSP-compliant

---

## Disclaimer & Licensing

This extension is **not affiliated with, endorsed by, or sponsored by Google**.

- **Google 3D Tiles:** Usage requires a valid Google Cloud API key with billing enabled and is subject to the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms). The official Google Maps logo and data attribution from visible tiles are displayed automatically on the 3D view per the [Map Tiles API attribution policy](https://developers.google.com/maps/documentation/tile/policies) — do not hide or obscure them.
- **OpenStreetMap:** OSM tiles are loaded from `tile.openstreetmap.org`, which is a volunteer-run, donation-funded service with a [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). This mode is intended for light/demo use only — heavy or commercial use may require switching to a different tile provider, as OSM's tile servers have limited capacity and inappropriate use may be blocked without notice. Data is licensed under the [ODbL](https://opendatacommons.org/licenses/odbl/). Attribution (© OpenStreetMap contributors) is displayed on the map.
- **3D Tiles:** This extension uses the [OGC 3D Tiles](https://www.ogc.org/standard/3DTiles/) open standard.

### Bundled Third-Party Libraries

| Library | License | Author |
|---|---|---|
| [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Apache-2.0 | NASA JPL / Garrett Johnson |
| [Three.js](https://github.com/mrdoob/three.js) | MIT | mrdoob and contributors |
| [urdf-loader](https://github.com/gkjohnson/urdf-loader) | Apache-2.0 | Garrett Johnson |

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full details.

## License

MIT License - see [LICENSE](LICENSE) for details.
