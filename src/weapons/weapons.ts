import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BALL_RADIUS, HALL, LANE, PIN_COM } from '../constants';
import type { Actor } from '../actors/actor';
import type { Effects } from '../fx/effects';
import { sfx } from '../fx/sfx';
import { materials } from '../physics';
import type { Ball } from '../world/ball';
import type { Obstacle } from '../world/hall';
import type { Pin } from '../world/pins';
import { createCheeseMesh, createWeaponModel } from './models';
import { STAND_LAYOUT, WEAPONS, type WeaponId, type WeaponSpec } from './specs';

/** What the weapon system needs from the rest of the game to resolve hits. */
export interface CombatWorld {
  actors(): Actor[];
  rollingBall(): Ball | null;
  pins(): Pin[];
  listener(): THREE.Vector3;
  hitActor(attacker: Actor, target: Actor, spec: WeaponSpec, dir: THREE.Vector3): void;
  hitBall(attacker: Actor, spec: WeaponSpec, impulse: THREE.Vector3): void;
}

export type RayHit =
  | { kind: 'actor'; actor: Actor; point: THREE.Vector3; dist: number }
  | { kind: 'ball'; ball: Ball; point: THREE.Vector3; dist: number }
  | { kind: 'pin'; pin: Pin; point: THREE.Vector3; dist: number }
  | { kind: 'floor' | 'wall'; point: THREE.Vector3; dist: number };

const MUZZLES: Record<WeaponId, THREE.Vector3> = {
  ak47: new THREE.Vector3(0, 0.03, -0.74),
  bat: new THREE.Vector3(0, -0.6, 0),
  cheese: new THREE.Vector3(0, -0.05, 0),
  confetti: new THREE.Vector3(0, 0, -0.52),
};

/** Seconds a dropped weapon lies around before it magically returns to the stand. */
const GROUND_RETURN = 30;
const RESTOCK_TIME = 6;
const PICKUP_RANGE = 1.1;

export class WeaponItem {
  readonly root = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  state: 'stand' | 'held' | 'ground' | 'restocking' = 'stand';
  holder: Actor | null = null;
  ammo: number;
  reloadT = 0;
  timer = 0;

  constructor(
    readonly spec: WeaponSpec,
    readonly slotPos: THREE.Vector3,
    readonly slotRot: THREE.Euler,
    private scene: THREE.Scene,
  ) {
    this.root.add(createWeaponModel(spec.id));
    this.muzzle.position.copy(MUZZLES[spec.id]);
    this.root.add(this.muzzle);
    this.ammo = spec.magazine;
    this.toStand();
  }

  get position() {
    return this.root.getWorldPosition(new THREE.Vector3());
  }

  toStand() {
    this.state = 'stand';
    this.holder = null;
    this.ammo = this.spec.magazine;
    this.reloadT = 0;
    this.root.visible = true;
    this.scene.add(this.root);
    this.root.position.copy(this.slotPos);
    this.root.rotation.copy(this.slotRot);
  }

  attachTo(actor: Actor) {
    this.state = 'held';
    this.holder = actor;
    this.root.visible = true;
    const mount = this.spec.mount === 'chest' ? actor.body.chestMount : actor.body.rightHand;
    mount.add(this.root);
    this.root.position.set(0, this.spec.id === 'cheese' ? -0.07 : 0, 0);
    this.root.rotation.set(0, 0, 0);
  }

  dropAt(p: THREE.Vector3) {
    this.state = 'ground';
    this.holder = null;
    this.timer = 0;
    this.scene.add(this.root);
    this.root.position.set(p.x, 0.05, p.z);
    this.root.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
  }

  consume() {
    this.state = 'restocking';
    this.holder = null;
    this.timer = 0;
    this.root.removeFromParent();
  }
}

interface CheeseProjectile {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  thrower: Actor;
  age: number;
  landed: boolean;
}

/** Weapons on the stand, in hands or on the floor, plus everything they fire. */
export class WeaponSystem {
  readonly items: WeaponItem[] = [];
  readonly obstacle: Obstacle;
  readonly standCenter = new THREE.Vector3(4.55, 0, 7.2);
  private cheeses: CheeseProjectile[] = [];

  constructor(
    private scene: THREE.Scene,
    private world: CANNON.World,
    private fx: Effects,
    private combat: CombatWorld,
  ) {
    this.obstacle = this.buildStand();
    const slots = standSlots();
    STAND_LAYOUT.forEach((id, i) => this.items.push(new WeaponItem(WEAPONS[id], slots[i].pos, slots[i].rot, scene)));
  }

  // ------------------------------------------------------------- stand

  private buildStand(): Obstacle {
    const g = new THREE.Group();
    this.scene.add(g);
    const x0 = 4.35;
    const x1 = 4.75;
    const z0 = 5.6;
    const z1 = 8.8;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.9, z1 - z0), new THREE.MeshStandardMaterial({ color: '#2a1838', roughness: 0.6 }));
    counter.position.set((x0 + x1) / 2, 0.45, (z0 + z1) / 2);
    counter.castShadow = counter.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.04, 0.04, z1 - z0 + 0.04), new THREE.MeshStandardMaterial({ color: '#4a2c1a', roughness: 0.35 }));
    top.position.set((x0 + x1) / 2, 0.92, (z0 + z1) / 2);
    top.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, z1 - z0), new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 2 }));
    edge.position.set(x0 - 0.01, 0.88, (z0 + z1) / 2);

    // Pegboard on the wall
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#6b4a2e';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#2b1a0e';
    for (let y = 8; y < 128; y += 16) for (let x = 8; x < 256; x += 16) ctx.fillRect(x - 2, y - 2, 4, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, z1 - z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    board.position.set(4.95, 1.6, (z0 + z1) / 2);
    board.receiveShadow = true;

    // Neon sign
    const sc = document.createElement('canvas');
    sc.width = 512;
    sc.height = 128;
    const s = sc.getContext('2d')!;
    s.font = 'italic 900 92px "Arial Black", Impact, sans-serif';
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.shadowColor = '#ef4444';
    s.shadowBlur = 30;
    s.fillStyle = '#ffd6d6';
    s.fillText('ARMORY', 256, 66);
    const signTex = new THREE.CanvasTexture(sc);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, toneMapped: false }));
    sign.position.set(4.9, 2.6, (z0 + z1) / 2);
    sign.rotation.y = -Math.PI / 2;
    const glow = new THREE.PointLight('#ff4d4d', 5, 4, 1.6);
    glow.position.set(4.2, 2.2, (z0 + z1) / 2);

    // Cheese plate
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.02, 24), new THREE.MeshStandardMaterial({ color: '#d4d4d8', roughness: 0.3 }));
    plate.position.set(4.55, 0.95, 8.2);

    g.add(counter, top, edge, board, sign, glow, plate);
    return { minX: x0 - 0.05, maxX: 5.0, minZ: z0 - 0.05, maxZ: z1 + 0.05 };
  }

  // ------------------------------------------------------------- pickup / drop

  /** Closest weapon an actor could pick up right now. */
  nearestPickup(actor: Actor): WeaponItem | null {
    const p = actor.position;
    let best: WeaponItem | null = null;
    let bestD = PICKUP_RANGE;
    for (const item of this.items) {
      if (item.state !== 'stand' && item.state !== 'ground') continue;
      const ip = item.state === 'stand' ? item.slotPos : item.root.position;
      const d = Math.hypot(ip.x - p.x, ip.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  nearStand(actor: Actor) {
    const p = actor.position;
    return p.x > 3.4 && Math.abs(p.z - this.standCenter.z) < 2.0;
  }

  available(): WeaponItem[] {
    return this.items.filter((i) => i.state === 'stand' || i.state === 'ground');
  }

  pickup(actor: Actor, item: WeaponItem) {
    if (actor.weapon) this.drop(actor);
    item.attachTo(actor);
    actor.weapon = item;
    actor.cooldown = 0.2;
    sfx.pickup();
  }

  drop(actor: Actor) {
    const item = actor.weapon;
    if (!item) return;
    actor.weapon = null;
    actor.action = null;
    item.dropAt(actor.position);
  }

  returnToStand(actor: Actor) {
    const item = actor.weapon;
    if (!item) return;
    actor.weapon = null;
    actor.action = null;
    item.toStand();
  }

  /** E: pick up the nearest weapon, or hang the held one back on the stand. */
  interact(actor: Actor): boolean {
    if (actor.carryingBall) return false;
    if (actor.weapon && this.nearStand(actor)) {
      this.returnToStand(actor);
      return true;
    }
    const item = this.nearestPickup(actor);
    if (item) {
      this.pickup(actor, item);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- using

  /** Starts the use animation if the weapon is ready. The effect fires at `hitAt` via `trigger`. */
  tryUse(actor: Actor, aim: THREE.Vector3): boolean {
    const item = actor.weapon;
    if (!item || actor.cooldown > 0 || actor.action || item.reloadT > 0) return false;
    if (item.spec.magazine && item.ammo <= 0) {
      item.reloadT = item.spec.reload;
      return false;
    }
    const spec = item.spec;
    actor.action = { kind: spec.action, t: 0, duration: spec.actionDuration, hitAt: spec.hitAt, fired: false, aim: aim.clone() };
    actor.cooldown = spec.cooldown;
    const d = this.combat.listener().distanceTo(actor.position);
    if (spec.id === 'bat') sfx.swing(d);
    if (spec.id === 'cheese') sfx.whoosh(d);
    return true;
  }

  /** The moment of impact / release of a use action. */
  trigger(actor: Actor, aim: THREE.Vector3) {
    const item = actor.weapon;
    if (!item) return;
    const spec = item.spec;
    const muzzle = item.muzzle.getWorldPosition(new THREE.Vector3());
    const listenerDist = this.combat.listener().distanceTo(muzzle);

    switch (spec.id) {
      case 'ak47': {
        item.ammo--;
        if (item.ammo <= 0) item.reloadT = spec.reload;
        const dir = aim.clone().sub(muzzle).normalize();
        dir.x += (Math.random() * 2 - 1) * 0.015;
        dir.y += (Math.random() * 2 - 1) * 0.015;
        dir.z += (Math.random() * 2 - 1) * 0.015;
        dir.normalize();
        const hit = this.castRay(muzzle, dir, spec.range, actor);
        this.fx.tracer(muzzle, hit.point);
        this.fx.muzzleFlash(muzzle);
        sfx.gunshot(listenerDist);
        this.applyBulletHit(actor, spec, hit, dir);
        break;
      }
      case 'bat': {
        const fwd = actor.body.forward;
        let any = false;
        for (const t of this.combat.actors()) {
          if (t === actor || t.knockedOut) continue;
          const to = t.position.clone().sub(actor.position);
          to.y = 0;
          const d = to.length();
          if (d > spec.range + t.radius) continue;
          if (d > 0.05 && to.normalize().dot(fwd) < 0.35) continue;
          this.combat.hitActor(actor, t, spec, fwd.clone());
          this.fx.burst(t.position.clone().setY(t.height * 0.85), '#fff6a0', 14, 3, 0.03, 0.4);
          any = true;
        }
        if (any) sfx.bonk(listenerDist);
        break;
      }
      case 'cheese': {
        this.throwCheese(actor, muzzle, aim);
        actor.weapon = null;
        item.consume();
        break;
      }
      case 'confetti': {
        const dir = aim.clone().sub(muzzle);
        dir.y = Math.max(dir.y, -0.2 * dir.length());
        dir.normalize();
        this.fx.confetti(muzzle, dir);
        this.fx.muzzleFlash(muzzle, 1.6, '#ff8ad8');
        sfx.pop(listenerDist);
        const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        for (const t of this.combat.actors()) {
          if (t === actor || t.knockedOut) continue;
          const to = t.position.clone().sub(actor.position).setY(0);
          const d = to.length();
          if (d > spec.range || to.normalize().dot(flat) < 0.82) continue;
          this.combat.hitActor(actor, t, spec, flat.clone());
        }
        const ball = this.combat.rollingBall();
        if (ball) {
          const bp = new THREE.Vector3(ball.body.position.x, ball.body.position.y, ball.body.position.z);
          const to = bp.sub(muzzle);
          if (to.length() < spec.range * 1.3 && to.normalize().dot(dir) > 0.8) {
            this.combat.hitBall(actor, spec, flat.multiplyScalar(1.6 * ball.body.mass));
          }
        }
        break;
      }
    }
  }

  private applyBulletHit(actor: Actor, spec: WeaponSpec, hit: RayHit, dir: THREE.Vector3) {
    switch (hit.kind) {
      case 'actor':
        this.combat.hitActor(actor, hit.actor, spec, dir);
        this.fx.burst(hit.point, '#ff5a5a', 8, 2.5, 0.02, 0.35);
        break;
      case 'ball': {
        const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        this.combat.hitBall(actor, spec, flat.multiplyScalar(0.3 * hit.ball.body.mass));
        this.fx.burst(hit.point, '#fff2a8', 10, 3, 0.015, 0.3);
        break;
      }
      case 'pin': {
        const b = hit.pin.body;
        const rel = new CANNON.Vec3(hit.point.x - b.position.x, hit.point.y - b.position.y, hit.point.z - b.position.z);
        b.wakeUp();
        b.applyImpulse(new CANNON.Vec3(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2), rel);
        this.fx.burst(hit.point, '#ffffff', 10, 2, 0.015, 0.4);
        break;
      }
      default:
        this.fx.burst(hit.point, '#ffcf6b', 6, 2, 0.012, 0.25);
    }
  }

  private throwCheese(actor: Actor, from: THREE.Vector3, target: THREE.Vector3) {
    const mesh = createCheeseMesh();
    this.scene.add(mesh);
    const body = new CANNON.Body({ mass: 1.1, material: materials.pin, shape: new CANNON.Box(new CANNON.Vec3(0.09, 0.05, 0.07)) });
    body.linearDamping = 0.05;
    body.angularDamping = 0.3;
    body.position.set(from.x, from.y, from.z);
    // Ballistic lob that lands on the target.
    const d = target.clone().sub(from);
    const flat = Math.hypot(d.x, d.z);
    const t = THREE.MathUtils.clamp(flat / 10, 0.3, 1.3);
    const g = 9.82;
    body.velocity.set(d.x / t, (d.y + 0.5 * g * t * t) / t, d.z / t);
    body.angularVelocity.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
    this.world.addBody(body);
    this.cheeses.push({ mesh, body, thrower: actor, age: 0, landed: false });
  }

  /** Removes cheese lying on the lane (the pinsetter "cleans up"). */
  clearLane() {
    this.cheeses = this.cheeses.filter((c) => {
      if (c.body.position.z > 0) return true;
      this.removeCheese(c);
      return false;
    });
  }

  private removeCheese(c: CheeseProjectile) {
    this.scene.remove(c.mesh);
    this.world.removeBody(c.body);
  }

  // ------------------------------------------------------------- raycast

  /** Casts a ray against characters, the ball, pins, the floor and the hall walls. */
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude: Actor | null): RayHit {
    let best: RayHit = { kind: 'wall', point: origin.clone().addScaledVector(dir, maxDist), dist: maxDist };
    const consider = (h: RayHit) => {
      if (h.dist > 0 && h.dist < best.dist) best = h;
    };

    for (const a of this.combat.actors()) {
      if (a === exclude || a.knockedOut) continue;
      const t = rayVerticalCylinder(origin, dir, a.position, a.radius * 0.9, 0, a.height);
      if (t !== null) consider({ kind: 'actor', actor: a, dist: t, point: origin.clone().addScaledVector(dir, t) });
    }
    const ball = this.combat.rollingBall();
    if (ball) {
      const c = new THREE.Vector3(ball.body.position.x, ball.body.position.y, ball.body.position.z);
      const t = raySphere(origin, dir, c, BALL_RADIUS * 1.3);
      if (t !== null) consider({ kind: 'ball', ball, dist: t, point: origin.clone().addScaledVector(dir, t) });
    }
    for (const pin of this.combat.pins()) {
      if (!pin.inWorld) continue;
      const p = pin.body.position;
      const base = new THREE.Vector3(p.x, p.y - PIN_COM, p.z);
      const t = rayVerticalCylinder(origin, dir, base, 0.06, 0, 0.38);
      if (t !== null) consider({ kind: 'pin', pin, dist: t, point: origin.clone().addScaledVector(dir, t) });
    }
    if (dir.y < -1e-4) {
      const t = -origin.y / dir.y;
      consider({ kind: 'floor', dist: t, point: origin.clone().addScaledVector(dir, t) });
    }
    for (const [axis, value] of [['x', HALL.minX], ['x', HALL.maxX], ['z', HALL.backZ], ['z', -LANE.length - LANE.pitLength], ['y', HALL.ceiling]] as const) {
      const dv = dir[axis];
      if (Math.abs(dv) < 1e-5) continue;
      const t = (value - origin[axis]) / dv;
      consider({ kind: 'wall', dist: t, point: origin.clone().addScaledVector(dir, t) });
    }
    return best;
  }

  // ------------------------------------------------------------- update

  update(dt: number) {
    for (const item of this.items) {
      if (item.reloadT > 0) {
        item.reloadT -= dt;
        if (item.reloadT <= 0) item.ammo = item.spec.magazine;
      }
      if (item.state === 'ground' || item.state === 'restocking') {
        item.timer += dt;
        const limit = item.state === 'ground' ? GROUND_RETURN : RESTOCK_TIME;
        if (item.timer > limit) item.toStand();
      }
    }

    const actors = this.combat.actors();
    this.cheeses = this.cheeses.filter((c) => {
      c.age += dt;
      const p = c.body.position;
      c.mesh.position.set(p.x, p.y, p.z);
      c.mesh.quaternion.set(c.body.quaternion.x, c.body.quaternion.y, c.body.quaternion.z, c.body.quaternion.w);
      if (p.y < -0.4 || c.age > 40) {
        this.removeCheese(c);
        return false;
      }
      if (c.landed) {
        // Cheese off the lane cleans itself up after a while.
        if (p.z > 0 && c.age > 8) {
          this.removeCheese(c);
          return false;
        }
        return true;
      }
      const pos = new THREE.Vector3(p.x, p.y, p.z);
      for (const a of actors) {
        if (a.knockedOut || (a === c.thrower && c.age < 0.4)) continue;
        const dxz = Math.hypot(a.position.x - p.x, a.position.z - p.z);
        if (dxz < a.radius + 0.1 && p.y < a.height + 0.05) {
          const dir = new THREE.Vector3(c.body.velocity.x, 0, c.body.velocity.z).normalize();
          this.combat.hitActor(c.thrower, a, WEAPONS.cheese, dir);
          this.fx.burst(pos, '#ffc933', 24, 3, 0.03, 0.7);
          sfx.splat(this.combat.listener().distanceTo(pos));
          this.removeCheese(c);
          return false;
        }
      }
      if (c.age > 0.4 && c.body.velocity.length() < 0.4) {
        c.landed = true;
        this.fx.burst(pos, '#ffc933', 8, 1.2, 0.02, 0.4);
      }
      return true;
    });
  }
}

/** Display positions on the stand, matching STAND_LAYOUT. */
function standSlots(): { pos: THREE.Vector3; rot: THREE.Euler }[] {
  return [
    { pos: new THREE.Vector3(4.86, 1.75, 6.4), rot: new THREE.Euler(0, 0, 0) },
    { pos: new THREE.Vector3(4.86, 1.4, 6.4), rot: new THREE.Euler(0, 0, 0) },
    { pos: new THREE.Vector3(4.83, 0.82, 7.05), rot: new THREE.Euler(0.1, 0, 0) },
    { pos: new THREE.Vector3(4.83, 0.82, 7.4), rot: new THREE.Euler(-0.1, 0, 0) },
    { pos: new THREE.Vector3(4.5, 1.0, 8.05), rot: new THREE.Euler(0, 0.4, 0) },
    { pos: new THREE.Vector3(4.62, 1.0, 8.3), rot: new THREE.Euler(0, 2.2, 0) },
    { pos: new THREE.Vector3(4.47, 1.0, 8.4), rot: new THREE.Euler(0, -1.1, 0) },
    { pos: new THREE.Vector3(4.55, 1.03, 5.95), rot: new THREE.Euler(0, 0, 0) },
    { pos: new THREE.Vector3(4.55, 1.03, 6.85), rot: new THREE.Euler(0, Math.PI, 0) },
  ];
}

/** Distance along the ray to a vertical cylinder (base at `base`, from y0 to y1 above it), or null. */
function rayVerticalCylinder(o: THREE.Vector3, d: THREE.Vector3, base: THREE.Vector3, r: number, y0: number, y1: number): number | null {
  const ox = o.x - base.x;
  const oz = o.z - base.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  if (c < 0) return null; // origin inside
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = o.y + d.y * t - base.y;
  return y >= y0 && y <= y1 ? t : null;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const oc = o.clone().sub(c);
  const b = oc.dot(d);
  const disc = b * b - (oc.lengthSq() - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
