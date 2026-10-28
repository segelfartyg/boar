import * as THREE from 'three';
import { HALL } from './constants';

/** Smoothly chases a desired position / look-at point. */
export class CameraRig {
  /** Orbit angles for the third-person view, driven by the mouse. */
  yaw = 0;
  pitch = -0.22;
  distance = 3.3;
  private pos = new THREE.Vector3(0, 2, 11);
  private look = new THREE.Vector3(0, 1, 0);

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.002, -1.05, 0.3);
  }

  /** Desired camera pose for the third-person view around `target`. */
  thirdPerson(target: THREE.Vector3): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const look = target.clone().add(new THREE.Vector3(0, 1.45, 0));
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const pos = look.clone().addScaledVector(dir, -this.distance);
    return { pos, look };
  }

  update(desiredPos: THREE.Vector3, desiredLook: THREE.Vector3, dt: number, rate: number) {
    const k = 1 - Math.exp(-rate * dt);
    this.pos.lerp(desiredPos, k);
    this.look.lerp(desiredLook, k);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, HALL.minX + 0.2, HALL.maxX - 0.2);
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, 0.25, HALL.ceiling - 0.2);
    this.pos.z = Math.min(this.pos.z, HALL.backZ - 0.2);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
