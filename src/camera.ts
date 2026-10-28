import * as THREE from 'three';
import { HALL } from './constants';

/** Smoothly chases a desired position / look-at point, with trauma-based shake. */
export class CameraRig {
  /** Orbit angles for the third-person view, driven by the mouse. */
  yaw = 0;
  pitch = -0.22;
  distance = 3.3;
  private pos = new THREE.Vector3(0, 2, 11);
  private look = new THREE.Vector3(0, 1, 0);
  /** 0–1; shake strength is trauma², so small hits barely register and big ones rattle. */
  private trauma = 0;
  private time = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.002, -1.05, 0.3);
  }

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  /** Keeps at least this much shake going (e.g. fear while enemies are close). */
  holdTrauma(v: number) {
    this.trauma = Math.max(this.trauma, v);
  }

  /** Direction the camera looks in the third-person view. */
  get lookDir(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  /**
   * Desired camera pose for the third-person view around `target`.
   * `shoulder` > 0 shifts it over the right shoulder (when aiming a weapon).
   */
  thirdPerson(target: THREE.Vector3, shoulder = 0): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const dir = this.lookDir;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const look = target.clone().add(new THREE.Vector3(0, 1.45 + shoulder * 0.1, 0)).addScaledVector(right, shoulder);
    const pos = look.clone().addScaledVector(dir, -(this.distance - shoulder * 1.2));
    return { pos, look };
  }

  update(desiredPos: THREE.Vector3, desiredLook: THREE.Vector3, dt: number, rate: number) {
    this.time += dt;
    const k = 1 - Math.exp(-rate * dt);
    this.pos.lerp(desiredPos, k);
    this.look.lerp(desiredLook, k);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, HALL.minX + 0.2, HALL.maxX - 0.2);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, 0.25, HALL.ceiling - 0.2);
    this.pos.z = Math.min(this.pos.z, HALL.backZ - 0.2);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    // Shake
    const s = this.trauma * this.trauma;
    if (s > 1e-4) {
      const t = this.time;
      const n = (f: number, o: number) => Math.sin(t * f + o) * Math.sin(t * f * 0.71 + o * 2.3);
      this.camera.position.x += n(47, 0) * s * 0.12;
      this.camera.position.y += n(53, 1) * s * 0.1;
      this.camera.rotateZ(n(41, 2) * s * 0.09);
      this.camera.rotateX(n(37, 3) * s * 0.04);
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
  }
}
