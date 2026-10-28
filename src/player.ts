import * as THREE from 'three';

const mat = (color: string, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });

function capsule(radius: number, length: number, material: THREE.Material, y: number) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 14), material);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

type Joints = {
  lHip: number;
  rHip: number;
  lKnee: number;
  rKnee: number;
  lShoulder: number;
  rShoulder: number;
  lShoulderZ: number;
  rShoulderZ: number;
  lElbow: number;
  rElbow: number;
  spine: number;
  hipY: number;
};

const NEUTRAL: Joints = {
  lHip: 0, rHip: 0, lKnee: 0, rKnee: 0,
  lShoulder: 0, rShoulder: 0, lShoulderZ: -0.08, rShoulderZ: 0.08,
  lElbow: 0.1, rElbow: 0.1, spine: 0, hipY: 0.95,
};

const ease = (t: number) => t * t * (3 - 2 * t);
const seg = (t: number, a: number, b: number) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
const lerp = THREE.MathUtils.lerp;

/** Seconds into the throw animation at which the ball leaves the hand. */
export const RELEASE_TIME = 1.08;
export const THROW_DURATION = 1.9;

/**
 * A bowler built from primitives. The model faces -Z in local space;
 * `yaw` = 0 means facing down the lane.
 */
export class Player {
  readonly root = new THREE.Group();
  readonly rightHand: THREE.Group;
  yaw = Math.PI;
  private hips: THREE.Group;
  private spine: THREE.Group;
  private lHip: THREE.Group;
  private rHip: THREE.Group;
  private lKnee: THREE.Group;
  private rKnee: THREE.Group;
  private lShoulder: THREE.Group;
  private rShoulder: THREE.Group;
  private lElbow: THREE.Group;
  private rElbow: THREE.Group;
  private head: THREE.Group;
  private walkPhase = 0;
  private walkAmount = 0;
  private current: Joints = { ...NEUTRAL };
  private time = 0;

  constructor(scene: THREE.Scene) {
    const skin = mat('#d9a07c', 0.55);
    const shirt = mat('#7c3aed', 0.5);
    const shirtPanel = mat('#facc15', 0.5);
    const pants = mat('#1f2433', 0.75);
    const hair = mat('#2b1a10', 0.8);
    const shoeA = mat('#d11d3c', 0.4);
    const shoeB = mat('#f1f1f1', 0.4);

    this.hips = pivot(this.root, 0, 0.95);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.19), pants);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    this.spine = pivot(this.hips, 0, 0.06);
    const chest = capsule(0.165, 0.26, shirt, 0.27);
    chest.scale.set(1, 1, 0.72);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.02), shirtPanel);
    panel.position.set(0.07, 0.29, -0.118);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 8, 20), shirtPanel);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.53;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin);
    neck.position.y = 0.56;
    this.spine.add(chest, panel, collar, neck);

    this.head = pivot(this.spine, 0, 0.7);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), skin);
    skull.scale.set(0.95, 1.05, 1);
    skull.castShadow = true;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.position.set(0, 0.015, 0.012);
    hairCap.rotation.x = 0.25;
    const eyeMat = mat('#111', 0.3);
    for (const x of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), eyeMat);
      eye.position.set(x, 0.015, -0.105);
      this.head.add(eye);
    }
    this.head.add(skull, hairCap);

    const arm = (side: number) => {
      const shoulder = pivot(this.spine, side * 0.215, 0.46);
      const sleeve = capsule(0.058, 0.1, shirt, -0.07);
      const upper = capsule(0.045, 0.18, skin, -0.16);
      const elbow = pivot(shoulder, 0, -0.3);
      const fore = capsule(0.042, 0.18, skin, -0.13);
      const hand = pivot(elbow, 0, -0.28);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), skin);
      palm.scale.set(0.8, 1.1, 0.6);
      palm.castShadow = true;
      shoulder.add(sleeve, upper);
      elbow.add(fore);
      hand.add(palm);
      return { shoulder, elbow, hand };
    };
    const la = arm(-1);
    const ra = arm(1);
    this.lShoulder = la.shoulder;
    this.lElbow = la.elbow;
    this.rShoulder = ra.shoulder;
    this.rElbow = ra.elbow;
    this.rightHand = ra.hand;

    const leg = (side: number) => {
      const hip = pivot(this.hips, side * 0.095, -0.05);
      hip.add(capsule(0.072, 0.26, pants, -0.2));
      const knee = pivot(hip, 0, -0.43);
      knee.add(capsule(0.062, 0.28, pants, -0.2));
      const shoe = new THREE.Group();
      shoe.position.set(0, -0.44, -0.04);
      const upperShoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), side < 0 ? shoeA : shoeB);
      const toe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.071, 0.09), side < 0 ? shoeB : shoeA);
      toe.position.z = -0.09;
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.104, 0.02, 0.26), mat('#222'));
      sole.position.y = -0.04;
      for (const m of [upperShoe, toe, sole]) m.castShadow = true;
      shoe.add(upperShoe, toe, sole);
      knee.add(shoe);
      return { hip, knee };
    };
    const ll = leg(-1);
    const rl = leg(1);
    this.lHip = ll.hip;
    this.lKnee = ll.knee;
    this.rHip = rl.hip;
    this.rKnee = rl.knee;

    scene.add(this.root);
  }

  get position() {
    return this.root.position;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Turns smoothly toward a target yaw. */
  faceTowards(targetYaw: number, dt: number, rate = 12) {
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, rate * dt);
  }

  /** Locomotion / idle animation. `speed` is the horizontal speed in m/s. */
  animate(dt: number, speed: number, holding: boolean) {
    this.time += dt;
    this.walkAmount = THREE.MathUtils.damp(this.walkAmount, Math.min(1, speed / 2.2), 10, dt);
    this.walkPhase += dt * (4 + speed * 2.6) * (speed > 0.05 ? 1 : 0);
    const a = this.walkAmount;
    const s = Math.sin(this.walkPhase);
    const c = Math.cos(this.walkPhase);

    const target: Joints = {
      ...NEUTRAL,
      lHip: s * 0.6 * a,
      rHip: -s * 0.6 * a,
      lKnee: -Math.max(0, -c) * 0.9 * a - 0.05,
      rKnee: -Math.max(0, c) * 0.9 * a - 0.05,
      lShoulder: -s * 0.5 * a,
      rShoulder: s * 0.5 * a,
      lElbow: 0.2 + 0.3 * a,
      rElbow: 0.2 + 0.3 * a,
      spine: 0.08 * a + Math.sin(this.time * 1.8) * 0.01,
      hipY: 0.95 - Math.abs(c) * 0.035 * a,
    };
    if (holding) {
      target.rShoulder = 0.55;
      target.rShoulderZ = -0.05;
      target.rElbow = 1.25;
      target.lShoulder = 0.5;
      target.lShoulderZ = 0.35;
      target.lElbow = 1.2;
    }
    this.blendTo(target, dt, 14);
  }

  /** Sets the aiming stance: knees slightly bent, ball held at chest. */
  animateStance(dt: number) {
    this.time += dt;
    this.blendTo(
      {
        ...NEUTRAL,
        lHip: 0.15, rHip: -0.05, lKnee: -0.3, rKnee: -0.15,
        rShoulder: 0.75, rShoulderZ: -0.08, rElbow: 1.35,
        lShoulder: 0.65, lShoulderZ: 0.35, lElbow: 1.3,
        spine: 0.18 + Math.sin(this.time * 2) * 0.01,
        hipY: 0.9,
      },
      dt,
      10,
    );
  }

  /**
   * Four-step approach: push-away, backswing, forward swing to release
   * and follow-through. Returns how far along the slide the body is (0–1).
   */
  animateThrow(t: number): number {
    const steps = THREE.MathUtils.clamp(t / 0.8, 0, 1);
    const stepPhase = steps * Math.PI * 3;
    const walk = 1 - seg(t, 0.7, 0.85);
    const s = Math.sin(stepPhase);

    const pushaway = seg(t, 0, 0.25);
    const backswing = seg(t, 0.25, 0.75);
    const forward = seg(t, 0.75, RELEASE_TIME);
    const follow = seg(t, RELEASE_TIME, 1.45);
    const slide = seg(t, 0.7, 1.05);

    let rShoulder = lerp(0.75, 1.0, pushaway);
    rShoulder = lerp(rShoulder, -1.5, backswing);
    rShoulder = lerp(rShoulder, 0.1, forward);
    rShoulder = lerp(rShoulder, 2.5, follow);
    const rElbow = lerp(1.35, 0.05, pushaway) + follow * 0.4;

    const j: Joints = {
      ...NEUTRAL,
      rShoulder,
      rShoulderZ: 0.06,
      rElbow,
      lShoulder: lerp(0.65, -0.2, pushaway) + slide * 0.2,
      lShoulderZ: lerp(0.35, -1.1, Math.max(pushaway * 0.4, slide)),
      lElbow: lerp(1.3, 0.2, pushaway),
      lHip: s * 0.55 * walk + slide * 0.95,
      rHip: -s * 0.55 * walk - slide * 0.65,
      lKnee: -Math.max(0, -Math.cos(stepPhase)) * 0.8 * walk - slide * 1.15,
      rKnee: -Math.max(0, Math.cos(stepPhase)) * 0.8 * walk - slide * 0.15,
      spine: 0.2 + slide * 0.55 - follow * 0.15,
      hipY: 0.92 - slide * 0.27 + follow * 0.05,
    };
    this.apply(j);
    // Body travel: steady steps, then a decelerating slide.
    return 0.75 * Math.min(1, t / 0.8) + 0.25 * seg(t, 0.75, 1.1);
  }

  private blendTo(target: Joints, dt: number, rate: number) {
    const k = 1 - Math.exp(-rate * dt);
    const c = this.current;
    for (const key of Object.keys(target) as (keyof Joints)[]) c[key] += (target[key] - c[key]) * k;
    this.apply(c);
  }

  private apply(j: Joints) {
    this.current = { ...j };
    this.lHip.rotation.x = j.lHip;
    this.rHip.rotation.x = j.rHip;
    this.lKnee.rotation.x = j.lKnee;
    this.rKnee.rotation.x = j.rKnee;
    this.lShoulder.rotation.set(j.lShoulder, 0, j.lShoulderZ);
    this.rShoulder.rotation.set(j.rShoulder, 0, j.rShoulderZ);
    this.lElbow.rotation.x = j.lElbow;
    this.rElbow.rotation.x = j.rElbow;
    this.spine.rotation.x = -j.spine;
    this.hips.position.y = j.hipY;
    this.root.rotation.y = this.yaw;
  }
}
