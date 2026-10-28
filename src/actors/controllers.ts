import * as THREE from 'three';
import type { CameraRig } from '../camera';
import type { Input } from '../input';
import type { WeaponItem } from '../weapons/weapons';
import type { Actor } from './actor';
import type { Arena } from './arena';
import { idleIntent, type Intent } from './intent';

/** Turns whatever drives an actor (keyboard, AI, network) into an Intent each tick. */
export interface Controller {
  update(actor: Actor, arena: Arena, dt: number): Intent;
}

const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** Keyboard + mouse for the person at this computer. */
export class LocalController implements Controller {
  /** Set by the game when it consumed E for something else (e.g. a bowling ball). */
  suppressInteract = false;

  constructor(
    private input: Input,
    private rig: CameraRig,
    private aimPoint: () => THREE.Vector3,
  ) {}

  update(actor: Actor): Intent {
    const input = this.input;
    const intent = idleIntent();
    let mx = 0;
    let mz = 0;
    if (input.isDown('KeyW', 'ArrowUp')) mz -= 1;
    if (input.isDown('KeyS', 'ArrowDown')) mz += 1;
    if (input.isDown('KeyA', 'ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD', 'ArrowRight')) mx += 1;
    if (mx || mz) {
      // Camera-relative movement
      const len = Math.hypot(mx, mz);
      const yaw = this.rig.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      intent.move = [(rx * mx - fx * mz) / len, (rz * mx - fz * mz) / len];
    }
    intent.run = input.isDown('ShiftLeft', 'ShiftRight');
    if (actor.weapon) {
      // Armed: strafe and face where the camera looks.
      intent.face = this.rig.yaw;
      const a = this.aimPoint();
      intent.aim = [a.x, a.y, a.z];
      intent.use = input.mouseHeld || input.isDown('KeyF');
    }
    intent.interact = input.pressed('KeyE') && !this.suppressInteract;
    intent.drop = input.pressed('KeyG');
    this.suppressInteract = false;
    return intent;
  }
}

/**
 * Placeholder for a networked player: the transport pushes the intents it
 * receives, the arena consumes them like any other controller's.
 */
export class RemoteController implements Controller {
  private latest = idleIntent();

  receive(intent: Intent) {
    this.latest = intent;
  }

  update(): Intent {
    const i = this.latest;
    // One-shot buttons fire once per received packet.
    this.latest = { ...i, interact: false, drop: false };
    return i;
  }
}

/**
 * A saboteur: grabs a weapon, then harasses the bowler, hardest while they
 * are lining up or throwing. Gunners and cheese throwers go after the
 * rolling ball too.
 */
export class SaboteurAI implements Controller {
  private wanted: WeaponItem | null = null;
  private goal = new THREE.Vector3();
  private engageT = 0;
  private think = Math.random() * 2;
  private loiterAngle = Math.random() * Math.PI * 2;
  private burstLeft = 5;
  private lastAmmo = 0;
  private pause = 0;
  private stuckT = 0;
  private sidestepT = 0;
  private sideDir = 1;
  private lastPos = new THREE.Vector3();
  private aimNoise = new THREE.Vector3();
  private noiseT = 0;

  update(actor: Actor, arena: Arena, dt: number): Intent {
    const intent = idleIntent();
    const me = actor.position;
    const bowler = arena.bowler;
    const phase = arena.phase();
    let aim: THREE.Vector3 | null = null;
    let wantUse = false;
    let urgent = false;

    // Wobbly aim, re-rolled now and then, so they miss sometimes.
    this.noiseT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT = 0.4 + Math.random() * 0.5;
      this.aimNoise.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(0.35);
    }

    if (!actor.weapon) {
      // Go shopping at the weapon stand.
      if (!this.wanted || (this.wanted.state !== 'stand' && this.wanted.state !== 'ground')) {
        const options = arena.weapons.available();
        this.wanted = options.length ? options[(Math.random() * options.length) | 0] : null;
      }
      if (this.wanted) {
        const p = this.wanted.state === 'stand' ? this.wanted.slotPos : this.wanted.root.position;
        this.goal.set(p.x - (this.wanted.state === 'stand' ? 0.55 : 0), 0, p.z);
        if (Math.hypot(p.x - me.x, p.z - me.z) < 0.95) intent.interact = true;
        urgent = phase === 'aiming' || phase === 'throwing';
      } else {
        this.loiter(bowler.position, dt);
      }
    } else {
      const spec = actor.weapon.spec;
      this.think -= dt;
      this.engageT -= dt;
      if (this.think <= 0) {
        this.think = 2.5;
        if (Math.random() < 0.3) this.engageT = 3 + Math.random() * 3;
      }
      const ball = arena.rollingBall();
      const ballZ = ball?.body.position.z ?? 0;

      if (phase === 'rolling' && ball && spec.id !== 'bat' && ballZ > -13) {
        // Sabotage the ball itself from beside the foul line.
        const side = me.x < 0 ? -1 : 1;
        this.goal.set(side * 1.15, 0, 0.6);
        const bp = new THREE.Vector3(ball.body.position.x, ball.body.position.y, ball.body.position.z);
        const v = ball.body.velocity;
        if (spec.id === 'cheese') aim = new THREE.Vector3(bp.x, 0.05, bp.z - 4);
        else aim = bp.add(new THREE.Vector3(v.x, 0, v.z).multiplyScalar(0.12));
        wantUse = me.distanceTo(aim) < spec.range;
        urgent = true;
      } else if (phase === 'aiming' || phase === 'throwing' || phase === 'rolling' || this.engageT > 0) {
        // Go for the bowler.
        const [lo, hi] = spec.preferredRange;
        const want = (lo + hi) / 2;
        const away = me.clone().sub(bowler.position).setY(0);
        if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, 1);
        away.normalize();
        // Prefer attacking from behind/beside rather than standing on the lane.
        if (away.z < -0.2) away.z = 0.2;
        away.normalize();
        this.goal.copy(bowler.position).addScaledVector(away, want);
        aim = bowler.position.clone().setY(bowler.body.chestHeight).add(this.aimNoise);
        const d = Math.hypot(bowler.position.x - me.x, bowler.position.z - me.z);
        wantUse = d > lo * 0.6 && d < hi * 1.35;
        urgent = true;
      } else {
        this.loiter(bowler.position, dt);
      }

      // Guns fire in bursts, counted by spent rounds.
      if (spec.automatic && wantUse) {
        if (this.pause > 0) {
          this.pause -= dt;
          wantUse = false;
        } else {
          const fired = this.lastAmmo - actor.weapon.ammo;
          if (fired > 0) this.burstLeft -= fired;
          if (this.burstLeft <= 0) {
            this.burstLeft = 4 + ((Math.random() * 5) | 0);
            this.pause = 0.7 + Math.random() * 0.9;
            wantUse = false;
          }
        }
      }
      this.lastAmmo = actor.weapon.ammo;
    }

    // Steering toward the goal, with a crude unstick.
    const to = this.goal.clone().sub(me).setY(0);
    const dist = to.length();
    if (dist > 0.3) {
      to.normalize();
      if (this.sidestepT > 0) {
        this.sidestepT -= dt;
        to.set(-to.z * this.sideDir, 0, to.x * this.sideDir);
      }
      intent.move = [to.x, to.z];
      intent.run = urgent || dist > 4;
      if (this.lastPos.distanceTo(me) < 0.15 * dt * actor.archetype.walkSpeed) {
        this.stuckT += dt;
        if (this.stuckT > 0.6) {
          this.stuckT = 0;
          this.sidestepT = 0.7;
          this.sideDir = Math.random() < 0.5 ? -1 : 1;
        }
      } else {
        this.stuckT = 0;
      }
    }
    this.lastPos.copy(me);

    if (aim) {
      intent.aim = [aim.x, aim.y, aim.z];
      if (dist < 1.2 || wantUse) intent.face = yawTo(me, aim);
      intent.use = wantUse && Math.abs(angleDiff(actor.body.yaw, yawTo(me, aim))) < 0.35;
    }
    return intent;
  }

  /** Hang around the bowler at a menacing distance. */
  private loiter(center: THREE.Vector3, dt: number) {
    this.loiterAngle += dt * 0.15;
    const r = 3.5;
    this.goal.set(center.x + Math.cos(this.loiterAngle) * r, 0, Math.max(center.z, 1) + Math.abs(Math.sin(this.loiterAngle)) * r);
  }
}

function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
