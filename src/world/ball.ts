import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL_RADIUS, LANE, THROW } from '../constants';
import { materials } from '../physics';
import { ballTexture } from '../textures';

export type Coverstock = 'Plastic' | 'Urethane' | 'Reactive';

export interface BallSpec {
  name: string;
  weightLb: number;
  cover: Coverstock;
  /** How strongly the coverstock grips the dry back end (multiplies hook). */
  hook: number;
  colors: [string, string, string];
}

export const BALL_SPECS: BallSpec[] = [
  { name: 'Bubblegum', weightLb: 8, cover: 'Plastic', hook: 0.4, colors: ['#ff7ac6', '#ffd1ea', '#ffffff'] },
  { name: 'Lime Spark', weightLb: 10, cover: 'Plastic', hook: 0.45, colors: ['#65c92a', '#d9ff6b', '#ffffff'] },
  { name: 'Ocean', weightLb: 11, cover: 'Urethane', hook: 0.7, colors: ['#0ea5e9', '#1e3a8a', '#bae6fd'] },
  { name: 'Ember', weightLb: 12, cover: 'Urethane', hook: 0.8, colors: ['#f97316', '#7c2d12', '#fde68a'] },
  { name: 'Nebula', weightLb: 13, cover: 'Reactive', hook: 1.0, colors: ['#7c3aed', '#0f172a', '#f0abfc'] },
  { name: 'Black Widow', weightLb: 14, cover: 'Reactive', hook: 1.1, colors: ['#151515', '#b91c1c', '#ffffff'] },
  { name: 'Gold Rush', weightLb: 15, cover: 'Reactive', hook: 1.2, colors: ['#ca8a04', '#3f2a00', '#fff7cc'] },
  { name: 'Hammerhead', weightLb: 16, cover: 'Reactive', hook: 1.3, colors: ['#1f2937', '#06b6d4', '#e0f2fe'] },
];

export type BallState = 'rack' | 'held' | 'rolling';

const UP = new THREE.Vector3(0, 1, 0);

export class Ball {
  readonly mesh: THREE.Mesh;
  readonly body: CANNON.Body;
  readonly material: THREE.MeshPhysicalMaterial;
  state: BallState = 'rack';
  /** -1 (hooks left) … 1 (hooks right). */
  spin = 0;
  inGutter = false;
  hitPins = false;
  private popT = 1;

  constructor(
    readonly spec: BallSpec,
    readonly slot: THREE.Vector3,
    private scene: THREE.Scene,
    private world: CANNON.World,
  ) {
    this.material = new THREE.MeshPhysicalMaterial({
      map: ballTexture(...spec.colors),
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);

    this.body = new CANNON.Body({
      mass: spec.weightLb * 0.4536,
      material: materials.ball,
      shape: new CANNON.Sphere(BALL_RADIUS),
      linearDamping: 0.01,
      angularDamping: 0.0,
      allowSleep: false,
    });
    this.body.addEventListener('collide', (e: { body: CANNON.Body }) => {
      if (e.body.material === materials.pin) this.hitPins = true;
    });
    this.returnToRack(false);
  }

  get label() {
    return `${this.spec.weightLb} lb ${this.spec.name}`;
  }

  setHighlighted(on: boolean, time: number) {
    this.material.emissiveIntensity = on ? 0.12 + Math.sin(time * 6) * 0.06 : 0;
  }

  attachTo(hand: THREE.Object3D) {
    this.state = 'held';
    this.material.emissiveIntensity = 0;
    hand.add(this.mesh);
    this.mesh.position.set(0, -BALL_RADIUS * 0.85, 0);
  }

  returnToRack(animate = true) {
    if (this.body.world) this.world.removeBody(this.body);
    this.state = 'rack';
    this.scene.add(this.mesh);
    this.mesh.position.copy(this.slot);
    this.popT = animate ? 0 : 1;
  }

  /** Releases the ball onto the lane with the given velocity. */
  release(position: THREE.Vector3, velocity: THREE.Vector3, spin: number) {
    this.scene.add(this.mesh);
    this.state = 'rolling';
    this.spin = spin;
    this.inGutter = false;
    this.hitPins = false;
    this.body.position.set(position.x, position.y, position.z);
    this.body.velocity.set(velocity.x, velocity.y, velocity.z);
    this.body.angularVelocity.setZero();
    this.body.quaternion.setFromEuler(this.mesh.rotation.x, this.mesh.rotation.y, this.mesh.rotation.z);
    this.world.addBody(this.body);
  }

  get speed() {
    const v = this.body.velocity;
    return Math.hypot(v.x, v.z);
  }

  /**
   * Lane model, applied every physics step. The front of the lane is oiled so
   * the ball mostly skids; once it reaches the dry back end the sidespin grips
   * and the ball hooks.
   */
  applyLaneForces() {
    if (this.state !== 'rolling') return;
    const b = this.body;
    const p = b.position;
    const v = b.velocity;
    const m = b.mass;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.05) return;
    const dir = { x: v.x / speed, z: v.z / speed };
    const onSurface = p.y < BALL_RADIUS + 0.03;

    if (!this.inGutter && p.z < 0 && p.z > -LANE.length && Math.abs(p.x) > LANE.halfWidth + 0.015 && p.y < BALL_RADIUS - 0.015) {
      this.inGutter = true;
    }

    if (this.inGutter && p.z > -LANE.length) {
      // Gutter is a half pipe: keep the ball centred in it.
      const cx = Math.sign(p.x) * (LANE.halfWidth + LANE.gutterWidth / 2);
      b.force.x += (cx - p.x) * m * 80 - v.x * m * 10;
      this.setRollingSpin(1, 0, dir);
      return;
    }

    if (!onSurface || p.z < -LANE.length) return;

    const travelled = -p.z;
    const dry = p.z > 0 ? 0.3 : THREE.MathUtils.smoothstep(travelled, LANE.oilLength - 2.5, LANE.oilLength + 1.0);
    const grip = 0.08 + 0.92 * dry;

    // Sidespin → lateral acceleration. Slower balls have more time to grip.
    const speedFactor = THREE.MathUtils.clamp(8 / speed, 0.7, 1.5);
    let a = this.spin * THROW.hookAccel * grip * speedFactor * this.spec.hook;
    if (this.hitPins) a *= 0.25;
    b.force.x += -dir.z * a * m;
    b.force.z += dir.x * a * m;

    // Friction with the dry boards slowly bleeds speed.
    const drag = (0.05 + 0.3 * dry) * m;
    b.force.x -= dir.x * drag;
    b.force.z -= dir.z * drag;

    this.setRollingSpin(0.35 + 0.65 * dry, 1 - 0.6 * dry, dir);
  }

  /** Visual rotation: forward roll blended with sidespin around the travel axis. */
  private setRollingSpin(rollFraction: number, sideFraction: number, dir: { x: number; z: number }) {
    const v = this.body.velocity;
    const w = this.body.angularVelocity;
    w.set(
      (v.z / BALL_RADIUS) * rollFraction + dir.x * this.spin * 28 * sideFraction,
      0,
      (-v.x / BALL_RADIUS) * rollFraction + dir.z * this.spin * 28 * sideFraction,
    );
  }

  update(dt: number) {
    if (this.state === 'rolling') {
      const { position: p, quaternion: q } = this.body;
      this.mesh.position.set(p.x, p.y, p.z);
      this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    } else if (this.state === 'rack' && this.popT < 1) {
      // Little bounce when the ball comes back up the return.
      this.popT = Math.min(1, this.popT + dt * 2.2);
      const s = this.popT;
      this.mesh.position.copy(this.slot).addScaledVector(UP, Math.sin(s * Math.PI) * 0.12 * (1 - s));
      this.mesh.scale.setScalar(0.6 + 0.4 * THREE.MathUtils.smoothstep(s, 0, 0.4));
    }
  }
}
