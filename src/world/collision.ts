import * as THREE from 'three';
import { WALK } from '../constants';
import type { Obstacle } from './hall';

/** Keeps a walker of the given radius inside the hall and out of furniture. */
export function resolveWalk(p: THREE.Vector3, radius: number, obstacles: Obstacle[]) {
  p.x = THREE.MathUtils.clamp(p.x, WALK.minX, WALK.maxX);
  p.z = THREE.MathUtils.clamp(p.z, WALK.minZ, WALK.maxZ);
  for (const o of obstacles) {
    const cx = THREE.MathUtils.clamp(p.x, o.minX, o.maxX);
    const cz = THREE.MathUtils.clamp(p.z, o.minZ, o.maxZ);
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < radius) {
      if (d > 1e-5) {
        p.x = cx + (dx / d) * radius;
        p.z = cz + (dz / d) * radius;
      } else {
        p.z = o.minZ - radius;
      }
    }
  }
}
