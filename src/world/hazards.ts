import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LANE } from '../constants';
import type { Effects } from '../fx/effects';
import { sfx } from '../fx/sfx';
import { materials } from '../physics';

export type HazardKind = 'tombstone' | 'spider';

const LIFETIME = 20;

/** A scary thing on the lane. Its kinematic body deflects the ball and scatters pins. */
abstract class Hazard {
  readonly group = new THREE.Group();
  readonly body: CANNON.Body;
  age = 0;
  protected target = new THREE.Vector3();

  constructor(
    readonly kind: HazardKind,
    shape: CANNON.Shape,
    protected scene: THREE.Scene,
    protected world: CANNON.World,
    start: THREE.Vector3,
  ) {
    this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: materials.wall, shape });
    this.body.position.set(start.x, start.y, start.z);
    this.target.copy(start);
    world.addBody(this.body);
    scene.add(this.group);
  }

  get dead() {
    return this.age > LIFETIME + 1.2;
  }

  /** 0 → 1 while appearing, 1 while alive, 1 → 0 while leaving. */
  protected presence() {
    return Math.min(THREE.MathUtils.smoothstep(this.age, 0, 1.0), 1 - THREE.MathUtils.smoothstep(this.age, LIFETIME, LIFETIME + 1.2));
  }

  /** Moves the kinematic body toward `target` via velocity, so collisions push things properly. */
  update(dt: number) {
    this.age += dt;
    this.animate(dt);
    const b = this.body;
    b.velocity.set((this.target.x - b.position.x) / dt, (this.target.y - b.position.y) / dt, (this.target.z - b.position.z) / dt);
    this.group.position.set(b.position.x, b.position.y, b.position.z);
  }

  protected abstract animate(dt: number): void;

  dispose() {
    this.scene.remove(this.group);
    this.world.removeBody(this.body);
  }
}

/** A gravestone that bursts up through the boards and slides side to side. */
class Tombstone extends Hazard {
  private phase = Math.random() * Math.PI * 2;
  private baseX: number;
  private eyes: THREE.MeshStandardMaterial;
  private light: THREE.PointLight;

  constructor(scene: THREE.Scene, world: CANNON.World, fx: Effects) {
    const z = -6 - Math.random() * 8;
    const x = (Math.random() * 2 - 1) * 0.25;
    super('tombstone', new CANNON.Box(new CANNON.Vec3(0.21, 0.32, 0.07)), scene, world, new THREE.Vector3(x, -0.7, z));
    this.baseX = x;

    const stone = new THREE.MeshStandardMaterial({ map: tombTexture(), roughness: 0.9 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.14), stone);
    slab.position.y = -0.08;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.14, 24, 1, false, -Math.PI / 2, Math.PI), stone);
    top.rotation.x = Math.PI / 2;
    top.rotation.z = Math.PI / 2;
    top.position.y = 0.16;
    this.eyes = new THREE.MeshStandardMaterial({ color: '#4dff7a', emissive: '#4dff7a', emissiveIntensity: 3 });
    for (const ex of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), this.eyes);
      eye.position.set(ex, 0.17, 0.072);
      this.group.add(eye);
    }
    // Faces the bowler (+z)
    for (const m of [slab, top]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.light = new THREE.PointLight('#4dff7a', 3, 2.5, 1.5);
    this.light.position.set(0, 0.2, 0.3);
    this.group.add(this.light);

    fx.burst(new THREE.Vector3(x, 0.05, z), '#8a7a66', 40, 2.5, 0.03, 0.8);
    sfx.rumble();
  }

  protected animate() {
    const p = this.presence();
    const y = THREE.MathUtils.lerp(-0.7, 0.32, p);
    const slide = Math.sin(this.age * 1.3 + this.phase) * 0.28 * THREE.MathUtils.smoothstep(this.age, 1, 2);
    this.target.set(this.baseX + slide, y, this.body.position.z);
    this.eyes.emissiveIntensity = 2 + Math.sin(this.age * 9) * 1.5;
    this.light.intensity = 2 + Math.sin(this.age * 9) * 1.2;
  }
}

/** A giant spider that drops from the ceiling on a thread and scuttles back and forth across the lane. */
class Spider extends Hazard {
  private legs: { upper: THREE.Group; lower: THREE.Group; side: number; i: number }[] = [];
  private thread: THREE.Line;
  private z: number;
  private dirX = Math.random() < 0.5 ? -1 : 1;
  private x = 0;

  constructor(scene: THREE.Scene, world: CANNON.World) {
    const z = -5 - Math.random() * 10;
    super('spider', new CANNON.Sphere(0.19), scene, world, new THREE.Vector3(0, 3.5, z));
    this.z = z;
    this.x = (Math.random() * 2 - 1) * 0.4;

    const fur = new THREE.MeshStandardMaterial({ color: '#141014', roughness: 0.95 });
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), fur);
    abdomen.scale.set(1, 0.85, 1.25);
    abdomen.position.set(0, 0.05, 0.2);
    const marking = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: '#b91c1c', emissive: '#4a0000' }));
    marking.scale.set(1, 0.4, 1.6);
    marking.position.set(0, 0.21, 0.2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), fur);
    head.position.set(0, 0.0, -0.1);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#ff2020', emissive: '#ff2020', emissiveIntensity: 3 });
    for (let i = 0; i < 6; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(i < 2 ? 0.022 : 0.013, 8, 6), eyeMat);
      eye.position.set((i % 2 ? 1 : -1) * (0.03 + Math.floor(i / 2) * 0.025), 0.05 - Math.floor(i / 2) * 0.012, -0.19 + Math.floor(i / 2) * 0.01);
      this.group.add(eye);
    }
    const fangMat = new THREE.MeshStandardMaterial({ color: '#e5e5e5' });
    for (const s of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 6), fangMat);
      fang.position.set(s * 0.025, -0.07, -0.18);
      fang.rotation.x = Math.PI;
      this.group.add(fang);
    }
    for (const m of [abdomen, head, marking]) {
      m.castShadow = true;
      this.group.add(m);
    }

    // Eight two-segment legs
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const upper = new THREE.Group();
        upper.position.set(side * 0.08, 0.02, -0.08 + i * 0.07);
        // Front legs splay forward, back legs backward; the left side is mirrored.
        const splay = 0.9 - i * 0.55;
        upper.rotation.y = side > 0 ? splay : Math.PI - splay;
        const u = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.3, 6), fur);
        u.rotation.z = Math.PI / 2;
        u.position.x = 0.15;
        const lower = new THREE.Group();
        lower.position.x = 0.3;
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.006, 0.36, 6), fur);
        l.position.y = -0.18;
        lower.add(l);
        upper.add(u, lower);
        upper.rotation.z = 0.5;
        lower.rotation.z = -0.1;
        u.castShadow = l.castShadow = true;
        this.group.add(upper);
        this.legs.push({ upper, lower, side, i });
      }
    }

    this.thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 4, 0)]), new THREE.LineBasicMaterial({ color: '#dddddd', transparent: true, opacity: 0.6 }));
    scene.add(this.thread);
    sfx.skitter();
  }

  protected animate(dt: number) {
    const drop = THREE.MathUtils.smoothstep(this.age, 0, 1.4);
    const leave = THREE.MathUtils.smoothstep(this.age, LIFETIME, LIFETIME + 1.2);
    const y = THREE.MathUtils.lerp(3.5, 0.2, drop) + leave * 3.3;
    if (drop >= 1 && leave === 0) {
      // Scuttle across the lane, turning back at the gutters.
      this.x += this.dirX * 0.9 * dt;
      if (Math.abs(this.x) > LANE.halfWidth + 0.1) {
        this.x = Math.sign(this.x) * (LANE.halfWidth + 0.1);
        this.dirX *= -1;
        if (Math.random() < 0.5) sfx.skitter();
      }
    }
    this.target.set(this.x, y, this.z);
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, this.dirX > 0 ? -Math.PI / 2 : Math.PI / 2, 8, dt);

    const walking = drop >= 1 && leave === 0;
    for (const leg of this.legs) {
      const ph = this.age * 16 + leg.i * 1.6 + (leg.side > 0 ? Math.PI : 0);
      leg.upper.rotation.z = 0.5 + (walking ? Math.sin(ph) * 0.25 : Math.sin(this.age * 3 + leg.i) * 0.1);
      leg.lower.rotation.z = -0.1 + (walking ? Math.max(0, Math.cos(ph)) * 0.3 : 0);
    }

    const p = this.body.position;
    const pos = this.thread.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, p.x, p.y + 0.1, p.z + 0.2);
    pos.setXYZ(1, p.x, 4.2, p.z + 0.2);
    pos.needsUpdate = true;
    this.thread.visible = drop < 1 || leave > 0;
  }

  dispose() {
    super.dispose();
    this.scene.remove(this.thread);
  }
}

export class HazardSystem {
  hazards: Hazard[] = [];

  constructor(
    private scene: THREE.Scene,
    private world: CANNON.World,
    private fx: Effects,
  ) {}

  spawn(kind: HazardKind) {
    this.hazards.push(kind === 'tombstone' ? new Tombstone(this.scene, this.world, this.fx) : new Spider(this.scene, this.world));
  }

  update(dt: number) {
    this.hazards = this.hazards.filter((h) => {
      h.update(dt);
      if (!h.dead) return true;
      h.dispose();
      return false;
    });
  }

  clear() {
    for (const h of this.hazards) h.dispose();
    this.hazards = [];
  }
}

function tombTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6f6a63';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,30,30' : '200,200,190'},0.15)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(20,20,20,0.6)';
  g.beginPath();
  g.moveTo(90, 0);
  g.lineTo(80, 30);
  g.lineTo(95, 55);
  g.stroke();
  g.fillStyle = '#2b2824';
  g.font = 'bold 34px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('R.I.P', 64, 80);
  g.font = '14px Georgia, serif';
  g.fillText('YOUR SCORE', 64, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
