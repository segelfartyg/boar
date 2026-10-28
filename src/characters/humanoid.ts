import * as THREE from 'three';

const mat = (color: string, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });

function capsule(radius: number, length: number, material: THREE.Material, y: number) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 14), material);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

/** A capsule hanging down from a joint that reaches the next joint `span` below, whatever its radius. */
function limb(radius: number, span: number, material: THREE.Material) {
  return capsule(radius, Math.max(0.02, span - 2 * radius + 0.03), material, -span / 2);
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Visual description of a character. Lengths scale with `height`, girth with `width`. */
export interface Look {
  height: number;
  width: number;
  /** 0 = flat, 1 = big round belly. */
  belly: number;
  skin: string;
  shirt: string;
  shirtPanel: string | null;
  pants: string;
  shoes: [string, string];
  hair: 'short' | 'long' | 'bald' | 'cap';
  hairColor: string;
  mustache?: boolean;
  angry?: boolean;
}

export const BOWLER_LOOK: Look = {
  height: 1,
  width: 1,
  belly: 0,
  skin: '#d9a07c',
  shirt: '#7c3aed',
  shirtPanel: '#facc15',
  pants: '#1f2433',
  shoes: ['#d11d3c', '#f1f1f1'],
  hair: 'short',
  hairColor: '#2b1a10',
};

/** How the arms carry whatever is in the hands. */
export type HoldPose = 'none' | 'ball' | 'rifle' | 'bat' | 'cheese' | 'cannon';
/** One-shot upper-body actions; `t` runs 0 → 1. */
export type ActionKind = 'fire' | 'swing' | 'throw' | 'blast' | 'shove';

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
  twist: number;
  /** Hip height as a fraction of the character's leg scale. */
  hipY: number;
};

const NEUTRAL: Joints = {
  lHip: 0, rHip: 0, lKnee: 0, rKnee: 0,
  lShoulder: 0, rShoulder: 0, lShoulderZ: -0.08, rShoulderZ: 0.08,
  lElbow: 0.1, rElbow: 0.1, spine: 0, twist: 0, hipY: 0.95,
};

const HOLD_POSES: Record<Exclude<HoldPose, 'none'>, Partial<Joints>> = {
  ball: { rShoulder: 0.55, rShoulderZ: -0.05, rElbow: 1.25, lShoulder: 0.5, lShoulderZ: 0.35, lElbow: 1.2 },
  rifle: { rShoulder: 1.25, rShoulderZ: -0.15, rElbow: 0.45, lShoulder: 1.45, lShoulderZ: 0.5, lElbow: 0.35 },
  cannon: { rShoulder: 1.1, rShoulderZ: -0.1, rElbow: 0.6, lShoulder: 1.25, lShoulderZ: 0.55, lElbow: 0.55 },
  bat: { rShoulder: 0.7, rShoulderZ: 0.15, rElbow: 1.9 },
  cheese: { rShoulder: 0.6, rShoulderZ: -0.05, rElbow: 1.4 },
};

const ease = (t: number) => t * t * (3 - 2 * t);
const seg = (t: number, a: number, b: number) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
const lerp = THREE.MathUtils.lerp;

/** Seconds into the throw animation at which the ball leaves the hand. */
export const RELEASE_TIME = 1.08;
export const THROW_DURATION = 1.9;

/**
 * A character built from primitives. The model faces -Z in local space;
 * `yaw` = 0 means facing down the lane.
 */
export class Humanoid {
  readonly root = new THREE.Group();
  readonly rightHand: THREE.Group;
  /** Mount in front of the chest for two-handed weapons. */
  readonly chestMount: THREE.Group;
  yaw = 0;
  readonly h: number;
  readonly w: number;
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
  private hairSway: THREE.Group | null = null;
  private walkPhase = 0;
  private walkAmount = 0;
  private current: Joints = { ...NEUTRAL };
  private time = 0;
  // Additive hit reaction + fear trembling, decaying over time.
  private react = { lean: 0, twist: 0, side: 0 };
  private tremble = 0;
  private koAngle = 0;
  knockedOut = false;

  constructor(scene: THREE.Scene, readonly look: Look = BOWLER_LOOK) {
    const h = (this.h = look.height);
    const w = (this.w = look.width);
    const headScale = 0.9 + 0.1 * h;
    const skin = mat(look.skin, 0.55);
    const shirt = mat(look.shirt, 0.5);
    const pants = mat(look.pants, 0.75);
    const hair = mat(look.hairColor, 0.8);
    const shoeA = mat(look.shoes[0], 0.4);
    const shoeB = mat(look.shoes[1], 0.4);
    this.root.rotation.order = 'YXZ';

    this.hips = pivot(this.root, 0, 0.95 * h);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.3 * w, 0.16, 0.19 * w), pants);
    pelvis.castShadow = true;
    this.hips.add(pelvis);

    this.spine = pivot(this.hips, 0, 0.06 * h);
    const chest = capsule(0.165 * w, 0.26 * h, shirt, 0.27 * h);
    chest.scale.set(1, 1, 0.72);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * w, 0.05 * w, 0.1 * h, 12), skin);
    neck.position.y = 0.56 * h;
    this.spine.add(chest, neck);
    let chestFront = 0.165 * w * 0.72;
    if (look.belly > 0) {
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2 * w * look.belly, 24, 18), shirt);
      belly.position.set(0, 0.16 * h, -0.06 * w);
      belly.scale.set(1, 0.95, 0.95);
      belly.castShadow = true;
      this.spine.add(belly);
      chestFront = Math.max(chestFront, 0.06 * w + 0.19 * w * look.belly);
    }
    if (look.shirtPanel) {
      const panelMat = mat(look.shirtPanel, 0.5);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1 * w, 0.42 * h, 0.02), panelMat);
      panel.position.set(0.07 * w, 0.29 * h, -chestFront);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065 * w, 0.02, 8, 20), panelMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.53 * h;
      this.spine.add(panel, collar);
    }
    this.chestMount = pivot(this.spine, 0.1 * w, 0.24 * h, -chestFront - 0.06);

    this.head = pivot(this.spine, 0, 0.56 * h + 0.14 * headScale);
    this.head.scale.setScalar(headScale);
    this.buildHead(skin, hair);

    const arm = (side: number) => {
      const shoulder = pivot(this.spine, side * 0.215 * w, 0.46 * h);
      const sleeve = capsule(0.058 * w, 0.1 * h, shirt, -0.07 * h);
      const upper = limb(0.045 * w, 0.3 * h, skin);
      const elbow = pivot(shoulder, 0, -0.3 * h);
      const fore = limb(0.042 * w, 0.28 * h, skin);
      const hand = pivot(elbow, 0, -0.28 * h);
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
      const hip = pivot(this.hips, side * 0.095 * w, -0.05 * h);
      hip.add(limb(0.072 * w, 0.43 * h, pants));
      const knee = pivot(hip, 0, -0.43 * h);
      knee.add(limb(0.062 * w, 0.42 * h, pants));
      const shoe = new THREE.Group();
      shoe.position.set(0, -0.44 * h, -0.04);
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

  private buildHead(skin: THREE.Material, hair: THREE.Material) {
    const look = this.look;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), skin);
    skull.scale.set(0.95, 1.05, 1);
    skull.castShadow = true;
    this.head.add(skull);

    const eyeMat = mat('#111', 0.3);
    for (const x of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), eyeMat);
      eye.position.set(x, 0.015, -0.105);
      this.head.add(eye);
      if (look.angry) {
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.012), mat(look.hair === 'bald' ? '#3a2a1a' : look.hairColor));
        brow.position.set(x, 0.045, -0.106);
        brow.rotation.z = x > 0 ? 0.45 : -0.45;
        this.head.add(brow);
      }
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), skin);
    nose.position.set(0, -0.005, -0.115);
    this.head.add(nose);
    if (look.mustache) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, 0.02), hair);
      m.position.set(0, -0.035, -0.11);
      this.head.add(m);
    }

    switch (look.hair) {
      case 'short': {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
        cap.position.set(0, 0.015, 0.012);
        cap.rotation.x = 0.25;
        this.head.add(cap);
        break;
      }
      case 'cap': {
        const capMat = mat(look.hairColor, 0.6);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.124, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
        dome.position.y = 0.02;
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.11), capMat);
        // Worn backwards
        brim.position.set(0, 0.025, 0.15);
        this.head.add(dome, brim);
        break;
      }
      case 'long': {
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
        top.position.set(0, 0.012, 0.004);
        this.head.add(top);
        // Long straight hair hanging down the back and sides; sways a little.
        const sway = new THREE.Group();
        sway.position.set(0, 0.06, 0);
        // Half-cylinder shell wrapping the back of the head, falling straight down.
        const backMat = (hair as THREE.MeshStandardMaterial).clone();
        backMat.side = THREE.DoubleSide;
        const back = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.13, 0.5, 20, 1, true, -Math.PI * 0.62, Math.PI * 1.24), backMat);
        back.position.set(0, -0.2, 0.012);
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.4, 0.07), hair);
        left.position.set(-0.115, -0.17, -0.035);
        const right = left.clone();
        right.position.x = 0.115;
        for (const m of [back, left, right]) m.castShadow = true;
        sway.add(back, left, right);
        this.head.add(sway);
        this.hairSway = sway;
        break;
      }
      case 'bald': {
        const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.1, transparent: true, opacity: 0.35 }));
        shine.position.set(0.03, 0.1, -0.04);
        this.head.add(shine);
        break;
      }
    }
  }

  get position() {
    return this.root.position;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** World-space height of the chest, used for aiming at this character. */
  get chestHeight() {
    return 1.25 * this.h;
  }

  /** Turns smoothly toward a target yaw. */
  faceTowards(targetYaw: number, dt: number, rate = 12) {
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, rate * dt);
  }

  /** Flinch from a hit. `strength` ~0.2 (graze) … 1 (bat to the face). */
  hitReact(strength: number) {
    this.react.lean -= 0.5 * strength;
    this.react.twist += (Math.random() * 2 - 1) * 0.6 * strength;
    this.react.side += (Math.random() * 2 - 1) * 0.4 * strength;
    this.tremble = Math.min(1, this.tremble + strength * 0.8);
  }

  /** Continuous fear shaking (0–1), e.g. while being harassed. */
  setTremble(v: number) {
    this.tremble = Math.max(this.tremble, v);
  }

  /** Per-frame bookkeeping shared by all animation modes: reactions, knock-out fall, hair. */
  tick(dt: number) {
    this.time += dt;
    const k = Math.exp(-6 * dt);
    this.react.lean *= k;
    this.react.twist *= k;
    this.react.side *= k;
    this.tremble *= Math.exp(-1.5 * dt);
    const target = this.knockedOut ? Math.PI / 2 : 0;
    this.koAngle = THREE.MathUtils.damp(this.koAngle, target, this.knockedOut ? 5 : 3, dt);
    this.root.position.y = Math.sin(this.koAngle) * 0.12 * this.w;
    if (this.hairSway) this.hairSway.rotation.x = Math.sin(this.time * 7) * 0.05 * this.walkAmount + this.react.lean * 0.3;
  }

  /** Locomotion with arms in the given hold pose, optionally overlaid by a one-shot action. */
  animate(dt: number, speed: number, hold: HoldPose | boolean = 'none', action: { kind: ActionKind; t: number } | null = null) {
    const pose: HoldPose = hold === true ? 'ball' : hold === false ? 'none' : hold;
    this.walkAmount = THREE.MathUtils.damp(this.walkAmount, Math.min(1, speed / (2.2 * this.h)), 10, dt);
    this.walkPhase += dt * (4 + (speed / this.h) * 2.6) * (speed > 0.05 ? 1 : 0);
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
    if (pose !== 'none') Object.assign(target, HOLD_POSES[pose]);
    let rate = 14;
    if (action) {
      Object.assign(target, actionPose(action.kind, action.t, target));
      rate = 28;
    }
    this.blendTo(target, dt, rate);
  }

  /** Sets the aiming stance: knees slightly bent, ball held at chest. */
  animateStance(dt: number) {
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
    const r = this.react;
    // Trembling: small high-frequency noise on the upper body.
    const tr = this.tremble * this.tremble;
    const n = (f: number) => Math.sin(this.time * f) * Math.sin(this.time * f * 1.7 + 1.3);
    this.lHip.rotation.x = j.lHip;
    this.rHip.rotation.x = j.rHip;
    this.lKnee.rotation.x = j.lKnee - tr * 0.15 * Math.abs(n(31));
    this.rKnee.rotation.x = j.rKnee - tr * 0.15 * Math.abs(n(29));
    this.lShoulder.rotation.set(j.lShoulder + tr * 0.25 * n(37), 0, j.lShoulderZ);
    this.rShoulder.rotation.set(j.rShoulder + tr * 0.25 * n(41), 0, j.rShoulderZ);
    this.lElbow.rotation.x = j.lElbow;
    this.rElbow.rotation.x = j.rElbow;
    this.spine.rotation.set(-(j.spine + r.lean) + tr * 0.06 * n(23), j.twist + r.twist + tr * 0.08 * n(27), r.side);
    this.head.rotation.set(tr * 0.1 * n(33), tr * 0.15 * n(19), 0);
    this.hips.position.y = j.hipY * this.h;
    this.root.rotation.set(this.koAngle, this.yaw, 0);
  }
}

/** Upper-body joint overrides for one-shot actions. */
function actionPose(kind: ActionKind, t: number, base: Joints): Partial<Joints> {
  switch (kind) {
    case 'fire': {
      const k = 1 - t;
      return { rShoulder: base.rShoulder + 0.15 * k, lShoulder: base.lShoulder + 0.12 * k, spine: base.spine - 0.06 * k };
    }
    case 'blast': {
      const k = Math.max(0, 1 - t * 1.5);
      return { rShoulder: base.rShoulder + 0.5 * k, lShoulder: base.lShoulder + 0.5 * k, spine: base.spine - 0.3 * k };
    }
    case 'swing': {
      // Overhead chop: wind up, smash down, recover.
      const up = seg(t, 0, 0.35);
      const down = seg(t, 0.35, 0.55);
      const rec = seg(t, 0.7, 1);
      return {
        rShoulder: lerp(lerp(lerp(base.rShoulder, 2.9, up), 0.5, down), base.rShoulder, rec),
        rElbow: lerp(lerp(lerp(base.rElbow, 0.7, up), 0.05, down), base.rElbow, rec),
        lShoulder: lerp(lerp(0, 2.6, up), 0.6, down) * (1 - rec),
        lShoulderZ: 0.3,
        lElbow: 0.5,
        spine: lerp(lerp(base.spine, -0.15, up), 0.4, down) * (1 - rec) + base.spine * rec,
        twist: lerp(lerp(0, 0.35, up), -0.35, down) * (1 - rec),
      };
    }
    case 'throw': {
      // Overhand lob.
      const back = seg(t, 0, 0.45);
      const fwd = seg(t, 0.45, 0.65);
      const rec = seg(t, 0.75, 1);
      return {
        rShoulder: lerp(lerp(lerp(base.rShoulder, 2.9, back), 1.1, fwd), base.rShoulder, rec),
        rElbow: lerp(lerp(lerp(base.rElbow, 1.7, back), 0.15, fwd), base.rElbow, rec),
        lShoulder: lerp(lerp(0, 1.4, back), 0.3, fwd) * (1 - rec),
        spine: (lerp(lerp(0, -0.2, back), 0.35, fwd) * (1 - rec)) + base.spine * rec,
        twist: lerp(lerp(0, 0.5, back), -0.3, fwd) * (1 - rec),
      };
    }
    case 'shove': {
      const out = seg(t, 0.2, 0.45) * (1 - seg(t, 0.6, 1));
      return { rShoulder: 1.5 * out, lShoulder: 1.5 * out, rElbow: 0.1, lElbow: 0.1, spine: base.spine + 0.25 * out };
    }
  }
}
