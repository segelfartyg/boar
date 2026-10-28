import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LANE, PIN_COM, PIN_MASS, PIN_SPOTS } from '../constants';
import { materials } from '../physics';

// Pin silhouette as [radius, height] pairs, approximating the USBC spec.
const PROFILE: [number, number][] = [
  [0.0, 0.0],
  [0.0258, 0.0],
  [0.031, 0.012],
  [0.042, 0.035],
  [0.052, 0.062],
  [0.0585, 0.09],
  [0.0605, 0.114],
  [0.0592, 0.14],
  [0.0545, 0.17],
  [0.0455, 0.2],
  [0.0345, 0.23],
  [0.0255, 0.26],
  [0.0228, 0.28],
  [0.0245, 0.3],
  [0.0305, 0.325],
  [0.0328, 0.345],
  [0.0305, 0.362],
  [0.0225, 0.374],
  [0.0105, 0.38],
  [0.0, 0.381],
];

const STRIPES: [number, number][] = [
  [0.262, 0.27],
  [0.278, 0.286],
];

let sharedGeometry: THREE.LatheGeometry | null = null;
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

/** Lathe geometry with the base at y = 0 and the red neck stripes baked into vertex colors. */
export function pinGeometry(): THREE.LatheGeometry {
  if (sharedGeometry) return sharedGeometry;
  const curve = new THREE.SplineCurve(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(160);
  pts[0].set(0, 0);
  pts[pts.length - 1].set(0, PROFILE[PROFILE.length - 1][1]);
  const geo = new THREE.LatheGeometry(pts, 32);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color('#f7f5ef');
  const red = new THREE.Color('#c8102e');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = STRIPES.some(([a, b]) => y >= a && y <= b) ? red : white;
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  sharedGeometry = geo;
  return geo;
}

export function pinMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.0 });
  }
  return sharedMaterial;
}

/** A static pin mesh with its base at the group origin. */
export function createPinMesh(): THREE.Mesh {
  const m = new THREE.Mesh(pinGeometry(), pinMaterial());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function createPinBody(): CANNON.Body {
  const body = new CANNON.Body({ mass: PIN_MASS, material: materials.pin });
  const add = (shape: CANNON.Shape, y: number) => body.addShape(shape, new CANNON.Vec3(0, y - PIN_COM, 0));
  add(new CANNON.Cylinder(0.0605, 0.03, 0.11, 10), 0.055);
  add(new CANNON.Cylinder(0.034, 0.0605, 0.12, 10), 0.17);
  add(new CANNON.Cylinder(0.026, 0.026, 0.1, 8), 0.28);
  add(new CANNON.Sphere(0.034), 0.345);
  body.linearDamping = 0.05;
  body.angularDamping = 0.12;
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.12;
  body.sleepTimeLimit = 0.35;
  return body;
}

const UP = new CANNON.Vec3(0, 1, 0);
const tmp = new CANNON.Vec3();

export class Pin {
  readonly group = new THREE.Group();
  readonly body = createPinBody();
  inWorld = false;

  constructor(
    readonly index: number,
    private world: CANNON.World,
  ) {
    const mesh = createPinMesh();
    mesh.position.y = -PIN_COM;
    this.group.add(mesh);
    this.group.visible = false;
  }

  get number() {
    return this.index + 1;
  }

  /** Places the pin upright (not simulated) with its base at height `lift`. */
  placeKinematic(x: number, z: number, lift: number) {
    this.removeFromWorld();
    this.group.visible = true;
    this.group.position.set(x, PIN_COM + lift, z);
    this.group.quaternion.identity();
  }

  /** Puts the pin into the simulation at its current group position, upright and asleep. */
  activate() {
    const p = this.group.position;
    this.body.position.set(p.x, PIN_COM, p.z);
    this.body.quaternion.set(0, 0, 0, 1);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    if (!this.inWorld) this.world.addBody(this.body);
    this.inWorld = true;
    this.body.sleep();
    this.sync();
  }

  removeFromWorld() {
    if (this.inWorld) this.world.removeBody(this.body);
    this.inWorld = false;
  }

  hide() {
    this.removeFromWorld();
    this.group.visible = false;
  }

  sync() {
    if (!this.inWorld) return;
    const { position: p, quaternion: q } = this.body;
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.set(q.x, q.y, q.z, q.w);
  }

  isStanding(): boolean {
    if (!this.inWorld || !this.group.visible) return false;
    const p = this.body.position;
    this.body.quaternion.vmult(UP, tmp);
    return (
      tmp.y > 0.82 &&
      p.y > PIN_COM - 0.04 &&
      Math.abs(p.x) < LANE.halfWidth &&
      p.z > -LANE.length
    );
  }

  isMoving(): boolean {
    if (!this.inWorld) return false;
    return this.body.velocity.length() > 0.04 || this.body.angularVelocity.length() > 0.15;
  }
}

type Phase = { action: 'sweep' | 'reset'; t: number; standing: Pin[]; spots: Map<Pin, { x: number; z: number }>; onDone: () => void };

const BAR_UP = 1.05;
const BAR_DOWN = 0.07;
const BAR_FRONT = -17.95;
const BAR_BACK = -19.65;
const LIFT = 0.55;

const seg = (t: number, a: number, b: number) => THREE.MathUtils.smoothstep(t, a, b);

/** Owns the ten pins and animates the pinsetter (sweep bar + pin deck). */
export class Pinsetter {
  readonly pins: Pin[];
  readonly sweepBar: THREE.Group;
  private phase: Phase | null = null;

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.pins = PIN_SPOTS.map((_, i) => new Pin(i, world));
    for (const p of this.pins) scene.add(p.group);

    this.sweepBar = new THREE.Group();
    const barMat = new THREE.MeshStandardMaterial({ color: '#2a2f3a', metalness: 0.7, roughness: 0.35 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(LANE.width + 0.42, 0.12, 0.05), barMat);
    bar.castShadow = true;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(LANE.width + 0.42, 0.03, 0.052),
      new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#7a5a00', roughness: 0.5 }),
    );
    stripe.position.y = 0.02;
    this.sweepBar.add(bar, stripe);
    this.sweepBar.position.set(0, BAR_UP, BAR_FRONT);
    scene.add(this.sweepBar);
  }

  get busy() {
    return this.phase !== null;
  }

  /** Immediately sets a full rack (used at startup). */
  rackAll() {
    this.pins.forEach((p, i) => {
      p.placeKinematic(PIN_SPOTS[i].x, PIN_SPOTS[i].z, 0);
      p.activate();
    });
  }

  standingPins(): Pin[] {
    return this.pins.filter((p) => p.isStanding());
  }

  anyMoving(): boolean {
    return this.pins.some((p) => p.isMoving());
  }

  sync() {
    for (const p of this.pins) p.sync();
  }

  /** 'sweep' clears deadwood and re-spots standing pins; 'reset' sets a fresh rack. */
  start(action: 'sweep' | 'reset', onDone: () => void) {
    const standing = action === 'sweep' ? this.standingPins() : [];
    const spots = new Map<Pin, { x: number; z: number }>();
    for (const p of standing) spots.set(p, { x: p.body.position.x, z: p.body.position.z });
    if (action === 'reset') this.pins.forEach((p, i) => spots.set(p, PIN_SPOTS[i]));
    this.phase = { action, t: 0, standing, spots, onDone };
  }

  update(dt: number) {
    const ph = this.phase;
    if (!ph) return;
    const prev = ph.t;
    ph.t += dt;
    const t = ph.t;

    // Sweep bar: down, back through the deck, forward again, up.
    const down = seg(t, 0, 0.45) - seg(t, 1.95, 2.35);
    this.sweepBar.position.y = THREE.MathUtils.lerp(BAR_UP, BAR_DOWN, down);
    const back = seg(t, 0.6, 1.25) - seg(t, 1.3, 1.8);
    this.sweepBar.position.z = THREE.MathUtils.lerp(BAR_FRONT, BAR_BACK, back);

    // Standing pins are picked up by the deck before the sweep...
    if (prev === 0) for (const p of ph.standing) p.removeFromWorld();
    const lift = seg(t, 0.15, 0.55) - seg(t, 1.5, 2.0);
    for (const p of ph.standing) {
      const s = ph.spots.get(p)!;
      p.placeKinematic(s.x, s.z, lift * LIFT);
    }

    // ...deadwood disappears into the pit as the bar passes over it.
    if (t > 0.6 && t < 1.4) {
      for (const p of this.pins) {
        if (ph.standing.includes(p) || !p.group.visible) continue;
        const passed = this.sweepBar.position.z < p.group.position.z - 0.05;
        if (passed || p.group.position.y < -0.1 || t > 1.25) p.hide();
      }
    }

    // A fresh rack is lowered from the deck.
    if (ph.action === 'reset' && t > 1.4) {
      const drop = LIFT * (1 - seg(t, 1.4, 2.0));
      this.pins.forEach((p) => {
        const s = ph.spots.get(p)!;
        p.placeKinematic(s.x, s.z, drop);
      });
    }

    if (t >= 2.4) {
      this.sweepBar.position.set(0, BAR_UP, BAR_FRONT);
      const toActivate = ph.action === 'reset' ? this.pins : ph.standing;
      for (const p of toActivate) p.activate();
      this.phase = null;
      ph.onDone();
    }
  }
}
