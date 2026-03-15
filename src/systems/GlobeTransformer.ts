import * as THREE from "three";
import { WGS84_ELLIPSOID, DEG2RAD } from "../constants";
import { TFSystem } from "./TFSystem";

// ==================== GLOBE TRANSFORMER ====================
// Uses a local ENU coordinate system centered at a GPS anchor to avoid
// Float32 precision loss that occurs when working at ECEF scale (~6.3M meters).
// All visualization geometry uses local coords; a parent THREE.Group at
// the anchor ECEF position handles globe placement.

export class GlobeTransformer {
  tfSystem: TFSystem;
  fixedFrame = "map";
  displayFrame = "base_link";
  framePrefix = "";
  altitudeOffset = 0;
  getGroundPosition: ((lat: number, lon: number) => THREE.Vector3 | null) | null = null;

  private currentGps = { lat: 0, lon: 0, alt: 0 };
  private anchorGps: { lat: number; lon: number; alt: number } | null = null;

  // Cached anchor ECEF position and ENU rotation (set once per anchor)
  private _anchorEcef: THREE.Vector3 | null = null;
  private _anchorEnu: THREE.Quaternion | null = null;
  private _anchorEnuInv: THREE.Quaternion | null = null;

  constructor(tfSystem: TFSystem) {
    this.tfSystem = tfSystem;
  }

  update(
    gpsLat: number,
    gpsLon: number,
    gpsAlt: number,
    altitudeOffset: number,
    fixedFrame: string,
    displayFrame: string,
    framePrefix = "",
  ): void {
    this.currentGps = { lat: gpsLat, lon: gpsLon, alt: gpsAlt };
    this.altitudeOffset = altitudeOffset;
    this.fixedFrame = fixedFrame || this.fixedFrame;
    this.displayFrame = displayFrame || this.displayFrame;
    this.framePrefix = framePrefix;

    if (!this.anchorGps) {
      this.anchorGps = { lat: gpsLat, lon: gpsLon, alt: gpsAlt };
      this._anchorEcef = null;
      this._anchorEnu = null;
      this._anchorEnuInv = null;
      console.log(
        `[GlobeTransformer] Anchor pinned at (${gpsLat.toFixed(7)}, ${gpsLon.toFixed(7)}, ${gpsAlt.toFixed(2)})`,
      );
    }
  }

  recenter(): void {
    this.anchorGps = null;
    this._anchorEcef = null;
    this._anchorEnu = null;
    this._anchorEnuInv = null;
    console.log("[GlobeTransformer] Anchor cleared — will re-pin on next GPS update");
  }

  getAnchor(): { lat: number; lon: number; alt: number } {
    return this.anchorGps || this.currentGps;
  }

  // === Anchor ECEF position (for positioning the localOriginGroup in the scene) ===
  // Note: altitudeOffset is NOT applied here — it's applied by the scene manager
  // on the localOriginGroup so it shifts all overlays relative to tiles.
  getAnchorEcefPosition(): THREE.Vector3 {
    if (this._anchorEcef) return this._anchorEcef.clone();
    const gps = this.anchorGps || this.currentGps;
    const latRad = gps.lat * DEG2RAD;
    const lonRad = gps.lon * DEG2RAD;
    const ecef = new THREE.Vector3();
    const groundPos = this.getGroundPosition?.(gps.lat, gps.lon);
    if (groundPos) {
      ecef.copy(groundPos);
    } else {
      WGS84_ELLIPSOID.getCartographicToPosition(latRad, lonRad, gps.alt, ecef);
    }
    this._anchorEcef = ecef.clone();
    return ecef;
  }

  // === Anchor ENU rotation (for orienting the localOriginGroup) ===
  getAnchorEnuQuaternion(): THREE.Quaternion {
    if (this._anchorEnu) return this._anchorEnu.clone();
    const gps = this.anchorGps || this.currentGps;
    const q = this.getEnuRotation(gps.lat * DEG2RAD, gps.lon * DEG2RAD);
    this._anchorEnu = q.clone();
    this._anchorEnuInv = q.clone().invert();
    return q;
  }

  private getAnchorEnuInverse(): THREE.Quaternion {
    if (this._anchorEnuInv) return this._anchorEnuInv.clone();
    this.getAnchorEnuQuaternion(); // populates _anchorEnuInv
    return this._anchorEnuInv!.clone();
  }

  resolveFrame(frameId: string): string {
    if (this.tfSystem.hasFrame(frameId)) return frameId;
    if (this.framePrefix && !frameId.startsWith(this.framePrefix)) {
      const prefixed = this.framePrefix + frameId;
      if (this.tfSystem.hasFrame(prefixed)) return prefixed;
    }
    return frameId;
  }

  // =========================================================================
  // transformToLocal: point in sourceFrame → local ENU coords at anchor.
  //
  // For fixedFrame == "map":
  //   - A point in "map" is returned as-is (map ≈ ENU at anchor).
  //   - A point in "base_link" is transformed to map via TF, then returned.
  //
  // This keeps all vertex data at small magnitudes → full Float32 precision.
  // =========================================================================
  transformToLocal(point: THREE.Vector3, sourceFrame: string): THREE.Vector3 | null {
    const resolved = this.resolveFrame(sourceFrame);
    const fixedResolved = this.resolveFrame(this.fixedFrame);

    if (resolved === fixedResolved) {
      return point.clone();
    }

    const rel = this.tfSystem.getRelativeTransform(resolved, fixedResolved);
    if (!rel) {
      return point.clone();
    }

    return point.clone().applyMatrix4(rel);
  }

  // =========================================================================
  // transformOrientationToLocal: orientation in sourceFrame → local ENU.
  // =========================================================================
  transformOrientationToLocal(
    quat: THREE.Quaternion,
    sourceFrame: string,
  ): THREE.Quaternion | null {
    const resolved = this.resolveFrame(sourceFrame);
    const fixedResolved = this.resolveFrame(this.fixedFrame);

    if (resolved === fixedResolved) {
      return quat.clone();
    }

    const rel = this.tfSystem.getRelativeTransform(resolved, fixedResolved);
    if (!rel) {
      return quat.clone();
    }

    const relRot = new THREE.Quaternion();
    rel.decompose(new THREE.Vector3(), relRot, new THREE.Vector3());
    return relRot.multiply(quat);
  }

  // =========================================================================
  // gpsToLocal: convert GPS lat/lon/alt → local ENU coords at anchor.
  // This is what NavSatLayer uses instead of raw ECEF.
  // =========================================================================
  gpsToLocal(lat: number, lon: number, _alt: number): THREE.Vector3 {
    // Simple geodetic difference → local ENU meters.
    // No per-point ground raycast → all points at consistent height.
    const anchor = this.anchorGps || this.currentGps;
    const meanLat = ((lat + anchor.lat) * 0.5) * DEG2RAD;
    const R = 6378137.0;
    const east  = R * (lon - anchor.lon) * DEG2RAD * Math.cos(meanLat);
    const north = R * (lat - anchor.lat) * DEG2RAD;
    // Small Z lift so points sit above ground surface
    return new THREE.Vector3(east, north, 0.3);
  }

  // =========================================================================
  // localToGps: convert local ENU coords back to GPS lat/lon/alt.
  // Inverse of gpsToLocal — used for publishing waypoints from click points.
  // =========================================================================
  localToGps(local: THREE.Vector3): { lat: number; lon: number; alt: number } {
    const anchor = this.anchorGps || this.currentGps;
    const R = 6378137.0;
    const anchorLatRad = anchor.lat * DEG2RAD;
    const lat = anchor.lat + (local.y / R) / DEG2RAD;
    const lon = anchor.lon + (local.x / (R * Math.cos(anchorLatRad))) / DEG2RAD;
    const alt = anchor.alt + local.z;
    return { lat, lon, alt };
  }

  // =========================================================================
  // Legacy: transformToGlobe still available for getFixedFrameGeographic.
  // =========================================================================
  getFixedFrameGeographic(): { lat: number; lon: number; alt: number } | null {
    const anchorEcef = this.getAnchorEcefPosition();
    const carto = { lat: 0, lon: 0, height: 0 };
    WGS84_ELLIPSOID.getPositionToCartographic(anchorEcef, carto);
    return {
      lat: carto.lat / DEG2RAD,
      lon: carto.lon / DEG2RAD,
      alt: carto.height,
    };
  }

  private getEnuRotation(latRad: number, lonRad: number): THREE.Quaternion {
    const up = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);
    const north = new THREE.Vector3(0, 0, 1);
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    if (east.lengthSq() < 0.001) east.set(1, 0, 0);
    const actualNorth = new THREE.Vector3().crossVectors(up, east).normalize();

    const mat = new THREE.Matrix4().makeBasis(east, actualNorth, up);
    const q = new THREE.Quaternion();
    q.setFromRotationMatrix(mat);
    return q;
  }
}
