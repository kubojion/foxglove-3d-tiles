# Changelog

## [2.0.0] - 2026-03-15

Major rewrite. Nearly every component has been rewritten or significantly expanded.

### Added

- **Waypoint publishing panel** - click on the 3D map to publish GPS waypoints (`PointStamped`) or navigation goals (`PoseStamped`). Drag to set heading with a real-time arrow preview. Quick presets for `/clicked_point` and `/goal_pose`.
- **Layers panel** - dedicated UI for managing overlay layers with add/remove, reorder, per-layer color, opacity, visibility, and topic selection.
- **Robot panel** - dedicated UI for URDF configuration, joint state topic, mesh folder loading, opacity slider, and frame selection.
- **Marker layer** - `visualization_msgs/Marker` and `MarkerArray` support with 11 marker types: Arrow, Cube, Sphere, Cylinder, Line Strip, Line List, Cube List, Sphere List, Points, Text, Triangle List.
- **Costmap layer** - `nav_msgs/OccupancyGrid` overlay for Nav2 costmaps with color-mapped transparency.
- **Measurement tool** - click two points on the map to measure straight-line distance in meters.
- **OpenStreetMap 2D mode** (experimental) - flat 2D map tiles from OpenStreetMap with top-down pan/zoom controls and configurable zoom level.
- **Custom local 3D Tiles** (experimental) - load folder-based 3D Tiles with recursive JSON tileset patching, configurable georeference, and native georef auto-detection.
- **Tile quality slider** - control Google 3D Tiles level-of-detail (errorTarget 6–20).
- **Config export/import** - save and load full panel configuration as JSON presets. API key is excluded from exports for security.
- **Google Maps attribution** - official Google Maps logo (outlined version) displayed in the bottom-left corner, and data attribution from visible tiles displayed in the bottom-right corner, per the [Map Tiles API attribution policy](https://developers.google.com/maps/documentation/tile/policies).
- **OpenStreetMap attribution** - "© OpenStreetMap contributors" displayed on the map in OSM mode.
- **Grid overlay** - configurable ground grid with adjustable size, spacing, height offset, and line width.
- **URDF loading from file** - load `.urdf` files directly in addition to topic-based loading.
- **TF frame prefix** - configurable TF frame prefix for multi-robot setups.
- **Camera follow mode** - camera automatically tracks the robot position.
- **Shift override** - hold Shift to temporarily re-enable camera movement during waypoint placement or measurement mode.
- **Per-layer topic selector** - dropdown with available topics and manual input toggle.
- **Purple UI theme** - consistent accent color across all panels.

### Changed

- **Settings panel** - completely redesigned with expandable sections, info tooltips, and map source selector (Google / OSM / Custom).
- **GPS tracking** - uses GlobeTransformer (ECEF/ENU) for precise coordinate transforms instead of simplified projection.
- **URDF system** - now supports local mesh folder loading with blob URL management. TF-driven joint updates.
- **Layer system** - rewritten as modular `MapLayer` classes with proper Three.js resource lifecycle (create/update/dispose).
- **Architecture** - split from monolithic component into ThreeDSceneManager + 4 panel components + 5 layer types + 3 system modules.
- Publisher name aligned to `kubojion`.

### Fixed

- Fixed the jaggedness/stepping of NAVSAT / PATH / TF by  `LocalOriginGroup`
- Trail line material leak - old material is now properly disposed on each trail update.
- Layer disposal on unmount - all layer Three.js resources are cleaned up when the panel unmounts.
- InstancedMesh phantom markers - instances where `transformToLocal` returns null no longer leave ghost markers at the origin.
- Stale config closure in `updateConfig` - uses functional state updater to prevent race conditions.
- Console log spam from costmap layer removed.

## [1.0.0] - 2026-02-13

Initial release.

- Google Photorealistic 3D Tiles rendering
- GPS tracking from `sensor_msgs/NavSatFix`
- URDF robot model from topic
- TF frame visualization
- Path, Odometry, and NavSat overlay layers
- Camera modes (Free/Follow)
- Robot marker with breadcrumb trail
- Settings persistence
