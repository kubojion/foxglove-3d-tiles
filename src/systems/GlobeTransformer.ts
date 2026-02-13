import * as THREE from "three";
import { WGS84_ELLIPSOID, DEG2RAD } from "../constants";
import { TFSystem } from "./TFSystem";

// ==================== GLOBE TRANSFORMER ====================

export class GlobeTransformer {
  tfSystem: TFSystem;
  fixedFrame = "odom";
  displayFrame = "base_link";
  framePrefix = "";
  altitudeOffset = 0;
  getGroundPosition: ((lat: number, lon: number) => THREE.Vector3 | null) | null = null;

  // Current raw GPS from the sensor (always up-to-date)
  private currentGps = { lat: 0, lon: 0, alt: 0 };

  // Pinned anchor: robot's ECEF position at pin time.
  // All subsequent movement comes from TF displacement, eliminating GPS jitter.
  private anchorGps: { lat: number; lon: number; alt: number } | null = null;
  // Display frame's world position at anchor time — used to compute TF displacement.
  private pinnedDisplayWorldPos: THREE.Vector3 | null = null;

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
    this.fixedFrame = fixedFrame;
    this.displayFrame = displayFrame;
    this.framePrefix = framePrefix;

    // Pin anchor on first GPS fix
    if (!this.anchorGps) {
      this.anchorGps = { lat: gpsLat, lon: gpsLon, alt: gpsAlt };
      console.log(
        `[GlobeTransformer] Anchor pinned at (${gpsLat.toFixed(7)}, ${gpsLon.toFixed(7)}, ${gpsAlt.toFixed(2)})`,
      );
    }
  }

  /** Clear the pinned anchor — it will re-pin on the next GPS update. */
  recenter(): void {
    this.anchorGps = null;
    this.pinnedDisplayWorldPos = null;
    console.log("[GlobeTransformer] Anchor cleared — will re-pin on next GPS update");
  }

  getAnchor(): { lat: number; lon: number; alt: number } {
    return this.anchorGps || this.currentGps;
  }

  /**
   * Get the geographic coordinates of the Fixed Frame origin.
   * Computes the Fixed Frame (0,0,0) in ECEF via transformToGlobe,
   * then converts ECEF → (lat, lon, alt) using the WGS84 ellipsoid.
   */
  getFixedFrameGeographic(): { lat: number; lon: number; alt: number } | null {
    const ecef = this.transformToGlobe(new THREE.Vector3(0, 0, 0), this.fixedFrame);
    if (!ecef) return null;

    const carto = { lat: 0, lon: 0, height: 0 };
    WGS84_ELLIPSOID.getPositionToCartographic(ecef, carto);

    return {
      lat: carto.lat / DEG2RAD,
      lon: carto.lon / DEG2RAD,
      alt: carto.height,
    };
  }

  /**
   * Helper: compute anchor ECEF (the pinned GPS position on the globe).
   */
  private getAnchorEcef(): THREE.Vector3 {
    const gps = this.anchorGps || this.currentGps;
    const latRad = gps.lat * DEG2RAD;
    const lonRad = gps.lon * DEG2RAD;

    const anchorEcef = new THREE.Vector3();
    const groundPos = this.getGroundPosition?.(gps.lat, gps.lon);
    if (groundPos) {
      const up = new THREE.Vector3();
      WGS84_ELLIPSOID.getCartographicToNormal(latRad, lonRad, up);
      anchorEcef.copy(groundPos).addScaledVector(up, this.altitudeOffset);
    } else {
      WGS84_ELLIPSOID.getCartographicToPosition(
        latRad, lonRad, gps.alt + this.altitudeOffset, anchorEcef,
      );
    }
    return anchorEcef;
  }

  /**
   * Helper: ENU rotation at the anchor GPS position.
   */
  /**
   * Resolve a frame ID: if frame not found in TF and a framePrefix is set,
   * try with the prefix prepended. This handles the case where message headers
   * use unprefixed frame IDs (e.g. "map") but TF tree has prefixed ones
   * (e.g. "simulator_actual/map").
   */
  resolveFrame(frameId: string): string {
    if (this.tfSystem.hasFrame(frameId)) return frameId;
    if (this.framePrefix && !frameId.startsWith(this.framePrefix)) {
      const prefixed = this.framePrefix + frameId;
      if (this.tfSystem.hasFrame(prefixed)) return prefixed;
    }
    return frameId; // return as-is — let caller handle missing frame
  }

  private getAnchorEnu(): THREE.Quaternion {
    const gps = this.anchorGps || this.currentGps;
    return this.getEnuRotation(gps.lat * DEG2RAD, gps.lon * DEG2RAD);
  }

  /**
   * Compute the robot's ECEF position.
   *
   * Uses a pinned GPS anchor + TF displacement model:
   *   robotECEF = anchorECEF + ENU × (currentDisplayWorldPos − pinnedDisplayWorldPos)
   *
   * Movement comes from TF (smooth odometry), not raw GPS (noisy).
   * Falls back to raw anchor ECEF when TF data is not yet available.
   */
  private getRobotEcef(): THREE.Vector3 {
    const anchorEcef = this.getAnchorEcef();
    const enuQuat = this.getAnchorEnu();
    const displayWorld = this.tfSystem.getWorldTransform(this.displayFrame);

    if (!displayWorld) {
      return anchorEcef;
    }

    // Pin display frame world position on first TF data available
    if (!this.pinnedDisplayWorldPos) {
      this.pinnedDisplayWorldPos = new THREE.Vector3();
      displayWorld.decompose(this.pinnedDisplayWorldPos, new THREE.Quaternion(), new THREE.Vector3());
      console.log(
        `[GlobeTransformer] Display world pos pinned at (${this.pinnedDisplayWorldPos.x.toFixed(3)}, ${this.pinnedDisplayWorldPos.y.toFixed(3)}, ${this.pinnedDisplayWorldPos.z.toFixed(3)})`,
      );
    }

    // Displacement in TF world frame since pin time
    const currentDisplayPos = new THREE.Vector3();
    displayWorld.decompose(currentDisplayPos, new THREE.Quaternion(), new THREE.Vector3());
    const displacement = currentDisplayPos.clone().sub(this.pinnedDisplayWorldPos);

    // Rotate displacement from TF world (≈ ENU) to ECEF and add to anchor
    displacement.applyQuaternion(enuQuat);
    return anchorEcef.add(displacement);
  }

  /**
   * Transform a point from sourceFrame to ECEF globe coordinates.
   *
   * Model (matches original, but with pinned anchor for anti-jitter):
   *   1. Robot ECEF = anchor + ENU × TF displacement
   *   2. Display frame → robot ECEF directly
   *   3. Other frames → robot ECEF + ENU × (sourceWorldPos − displayWorldPos)
   *
   * Both position and orientation use WORLD transforms, keeping them consistent.
   */
  transformToGlobe(point: THREE.Vector3, sourceFrame: string): THREE.Vector3 | null {
    // Auto-resolve frame prefix (e.g. "map" → "simulator_actual/map")
    const resolved = this.resolveFrame(sourceFrame);
    const robotEcef = this.getRobotEcef();
    const enuQuat = this.getAnchorEnu();

    // Get display frame world transform (for offset calculations)
    const displayWorld = this.tfSystem.getWorldTransform(this.displayFrame);

    // ---- sourceFrame == displayFrame ----
    if (resolved === this.displayFrame) {
      if (!displayWorld || point.lengthSq() === 0) {
        // No TF or zero offset → just return robot ECEF
        if (point.lengthSq() > 0) {
          robotEcef.add(point.clone().applyQuaternion(enuQuat));
        }
        return robotEcef;
      }
      // Rotate local point by displayFrame's world orientation (includes heading),
      // then by ENU to get into ECEF
      const displayQuat = new THREE.Quaternion();
      displayWorld.decompose(new THREE.Vector3(), displayQuat, new THREE.Vector3());
      const worldOffset = point.clone().applyQuaternion(displayQuat).applyQuaternion(enuQuat);
      return robotEcef.add(worldOffset);
    }

    // ---- Other frames: offset from robot via world-frame differences ----
    const sourceWorld = this.tfSystem.getWorldTransform(resolved);
    if (!sourceWorld || !displayWorld) {
      // No TF data — assume coincident with robot
      return robotEcef.add(point.clone().applyQuaternion(enuQuat));
    }

    // Transform input point into TF world frame
    const pointInWorld = point.clone().applyMatrix4(sourceWorld);

    // Get displayFrame position in TF world frame
    const displayPos = new THREE.Vector3();
    displayWorld.decompose(displayPos, new THREE.Quaternion(), new THREE.Vector3());

    // Offset from robot in TF world coords (odom ≈ ENU-aligned)
    const worldOffset = pointInWorld.sub(displayPos);

    // Rotate odom offset → ECEF via ENU
    worldOffset.applyQuaternion(enuQuat);

    return robotEcef.add(worldOffset);
  }

  /**
   * Transform an orientation from sourceFrame to ECEF globe coordinates.
   * Uses WORLD transform to include the full TF chain (map→odom→base_link heading).
   */
  transformOrientationToGlobe(
    quat: THREE.Quaternion,
    sourceFrame: string,
  ): THREE.Quaternion | null {
    // Auto-resolve frame prefix
    const resolved = this.resolveFrame(sourceFrame);
    const enuQuat = this.getAnchorEnu();

    // Use WORLD transform of sourceFrame — this includes the full TF chain
    // (e.g. map → odom → base_link heading) so orientation is correct.
    const sourceWorld = this.tfSystem.getWorldTransform(resolved);
    if (!sourceWorld) {
      return enuQuat.clone().multiply(quat);
    }

    const sourceQuat = new THREE.Quaternion();
    sourceWorld.decompose(new THREE.Vector3(), sourceQuat, new THREE.Vector3());

    // ENU × worldRotation(source) × inputQuat
    return enuQuat.clone().multiply(sourceQuat).multiply(quat);
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
