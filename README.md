# Foxglove 3D Tiles

A [Foxglove Studio](https://foxglove.dev/) extension panel that renders OGC 3D Tiles (including Google Photorealistic 3D Tiles) with real-time ROS 2 integration for GPS tracking, URDF robot visualization, and TF frame display.

Built with [Three.js](https://threejs.org/) and [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS). No Cesium dependency.


<br>
<div align="center">
  <img src="https://github.com/user-attachments/assets/c44bc4c6-31f9-4d44-99ea-dc3fb3ccadb1" width="100%">
  <br><br>
  <em>Foxglove 3D Tiles</em>
</div>
<br>


## Features

- **3D Tiles rendering** -- Google Photorealistic 3D Tiles or custom local tilesets
- **GPS tracking** -- real-time robot position from `sensor_msgs/NavSatFix`
- **URDF rendering** -- full robot model from `std_msgs/String` with joint state updates
- **TF frame visualization** -- render the TF tree as 3D axes on the map
- **Visualization layers** -- configurable Path, Odometry, and NavSat layers from arbitrary topics
- **Camera modes** -- Free, Follow
- **Robot marker and trail** -- red sphere marker with breadcrumb trail
- **Local tileset support** -- load folder-based 3D Tiles with configurable georeference (lat/lon/alt/heading/scale)
- **Snap-to-robot / snap-to-fixed-frame** -- quickly align custom tile origin to current robot or fixed frame position
- **Settings persistence** -- all configuration saved across sessions

## Prerequisites

### API Key (for Google 3D Tiles)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Map Tiles API**
3. Create an API key under **Credentials**

A valid API key is only required when using Google 3D Tiles as the map source. Custom local tilesets do not require an API key.

## Installation

```bash
cd foxglove-3d-tiles
npm install
npm run local-install
```

Restart Foxglove Studio, then add the **"Foxglove 3D Tiles"** panel from the panel list.

## Usage

1. Open the Settings panel (gear icon)
2. Select a map source (Google 3D Tiles or Custom)
3. If using Google tiles, enter your API key
4. Set the GPS topic (e.g. `/gps/fix`)
5. Optionally enable URDF, TF frames, robot marker, or visualization layers
6. Play a ROS bag or connect to live data

### Custom Local Tilesets

1. Set map source to **Custom**
2. Click **Load Custom 3D Tiles Folder** and select a folder containing `tileset.json`
3. Adjust latitude, longitude, altitude, heading, and scale to georeference the tileset

### Visualization Layers

Add layers from the Settings panel to visualize additional topics:

| Layer Type | Message Type | Description |
|---|---|---|
| Path | `nav_msgs/Path` | Line strip from pose array |
| Odometry | `nav_msgs/Odometry` | Arrow at each pose |
| NavSat | `sensor_msgs/NavSatFix` | Dot buffer on the globe |

## Development

```bash
npm run build        # Development build
npm run local-install # Build + install into Foxglove Studio
npm run package      # Package as .foxe for distribution
```

## ROS Topics

| Topic | Type | Purpose |
|---|---|---|
| GPS topic (configurable) | `sensor_msgs/NavSatFix` | Robot position |
| URDF topic (configurable) | `std_msgs/String` | Robot description XML |
| Joint state topic (configurable) | `sensor_msgs/JointState` | Joint positions |
| `/tf` | `tf2_msgs/TFMessage` | Transform tree |
| `/tf_static` | `tf2_msgs/TFMessage` | Static transforms |

## Disclaimer & Licensing

This extension is not affiliated with, endorsed by, or sponsored by Google.

- **Google 3D Tiles:** Usage requires a valid Google Cloud API Key and is subject to the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms).
- **Cesium / 3D Tiles:** This extension uses the OGC 3D Tiles standard.
- **Attribution:** When using Google 3D Tiles, the required Google logo and data attribution are rendered automatically by the renderer. Do not hide or obscure these attributions.

## License

MIT License
