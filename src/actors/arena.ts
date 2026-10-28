import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { ArchetypeId } from '../characters/archetypes';
import type { Effects } from '../fx/effects';
import { sfx } from '../fx/sfx';
import type { Ball } from '../world/ball';
import { resolveWalk } from '../world/collision';
import type { Obstacle } from '../world/hall';
import { HazardSystem } from '../world/hazards';
import type { Pin } from '../world/pins';
import type { WeaponSpec } from '../weapons/specs';
import { WeaponSystem, type CombatWorld } from '../weapons/weapons';
import { Actor, type Role } from './actor';
import { SaboteurAI, type Controller } from './controllers';
import { EventBus } from './events';
import { idleIntent, type Intent } from './intent';

/** Where the bowler is in their shot; saboteurs pick their moment from this. */
export type BowlingPhase = 'idle' | 'aiming' | 'throwing' | 'rolling' | 'resetting';

/** What the arena needs to know about the bowling game around it. */
export interface ArenaHooks {
  phase(): BowlingPhase;
  rollingBall(): Ball | null;
  pins(): Pin[];
  listener(): THREE.Vector3;
}

const KO_LINGER = 5;
const GRUNT_PITCH: Record<ArchetypeId, number> = { bowler: 1, fat: 0.65, short: 1.6, jimpan: 1.15 };

/**
 * The authoritative simulation of everyone walking around the hall:
 * applies controller intents, resolves weapon hits and emits events.
 * In a networked game this runs on the host and its events are replicated.
 */
export class Arena implements CombatWorld {
  readonly members = new Map<string, Actor>();
  readonly events = new EventBus();
  readonly weapons: WeaponSystem;
  readonly hazards: HazardSystem;
  bowler!: Actor;

  constructor(
    private scene: THREE.Scene,
    world: CANNON.World,
    private fx: Effects,
    private obstacles: Obstacle[],
    private hooks: ArenaHooks,
  ) {
    this.weapons = new WeaponSystem(scene, world, fx, this);
    obstacles.push(this.weapons.obstacle);
    this.hazards = new HazardSystem(scene, world, fx);
  }

  // ------------------------------------------------------------- membership

  join(archetype: ArchetypeId, role: Role, controller: Controller | null, at: THREE.Vector3): Actor {
    const actor = new Actor(this.scene, archetype, role, controller);
    actor.position.copy(at);
    actor.body.yaw = 0;
    this.members.set(actor.id, actor);
    if (role === 'bowler') this.bowler = actor;
    this.events.emit({ type: 'spawn', actorId: actor.id });
    return actor;
  }

  /** Brings in an AI saboteur through the entrance at the back of the hall. */
  spawnSaboteur(archetype: ArchetypeId): Actor {
    const at = new THREE.Vector3((Math.random() * 2 - 1) * 3, 0, 11.2);
    const a = this.join(archetype, 'saboteur', new SaboteurAI(), at);
    a.body.yaw = 0;
    this.fx.burst(at.clone().setY(0.4), '#a78bfa', 40, 3, 0.03, 0.7, 2);
    return a;
  }

  leave(actor: Actor) {
    if (actor.weapon) this.weapons.drop(actor);
    actor.dispose(this.scene);
    this.members.delete(actor.id);
    this.events.emit({ type: 'despawn', actorId: actor.id });
  }

  clearSaboteurs() {
    for (const a of [...this.members.values()]) if (a.role === 'saboteur') this.leave(a);
    this.hazards.clear();
  }

  phase() {
    return this.hooks.phase();
  }

  // ------------------------------------------------------------- CombatWorld

  actors(): Actor[] {
    return [...this.members.values()];
  }

  rollingBall() {
    return this.hooks.rollingBall();
  }

  pins() {
    return this.hooks.pins();
  }

  listener() {
    return this.hooks.listener();
  }

  hitActor(attacker: Actor, target: Actor, spec: WeaponSpec, dir: THREE.Vector3) {
    if (target.knockedOut) return;
    target.hp = Math.max(0, target.hp - spec.damage);
    target.sinceHit = 0;
    const push = dir.clone().setY(0).normalize().multiplyScalar(spec.knockback * target.archetype.knockback);
    target.knock.add(push);
    target.stagger = Math.max(target.stagger, spec.disrupt * 0.7);
    target.body.hitReact(Math.min(1, spec.disrupt + 0.25));
    sfx.grunt(GRUNT_PITCH[target.archetype.id]);
    this.events.emit({ type: 'hit', attackerId: attacker.id, targetId: target.id, weapon: spec.id, damage: spec.damage, disrupt: spec.disrupt });

    if (target.role !== 'bowler' && target.hp <= 0) {
      target.koTime = 0;
      target.body.knockedOut = true;
      target.action = null;
      if (target.weapon) this.weapons.drop(target);
      this.events.emit({ type: 'knockout', actorId: target.id, byId: attacker.id });
    }
  }

  hitBall(attacker: Actor, spec: WeaponSpec, impulse: THREE.Vector3) {
    const ball = this.hooks.rollingBall();
    if (!ball) return;
    ball.body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z));
    this.events.emit({ type: 'ballHit', attackerId: attacker.id, weapon: spec.id });
  }

  // ------------------------------------------------------------- simulation

  update(dt: number) {
    for (const actor of [...this.members.values()]) {
      actor.body.tick(dt);
      actor.cooldown = Math.max(0, actor.cooldown - dt);
      actor.stagger = Math.max(0, actor.stagger - dt);
      actor.sinceHit += dt;
      // The bowler's composure recovers when left alone.
      if (actor.role === 'bowler' && actor.sinceHit > 2.5) actor.hp = Math.min(actor.maxHp, actor.hp + 10 * dt);

      if (actor.knockedOut) {
        actor.koTime += dt;
        if (actor.koTime > KO_LINGER) {
          actor.position.y -= dt * 0.8;
          if (actor.koTime > KO_LINGER + 1.5) this.leave(actor);
        }
        actor.updateNameplate();
        continue;
      }

      if (!actor.busy && actor.knock.lengthSq() > 1e-4) {
        actor.position.addScaledVector(actor.knock, dt);
        resolveWalk(actor.position, actor.radius, this.obstacles);
      }
      actor.knock.multiplyScalar(Math.exp(-5 * dt));

      this.advanceAction(actor, dt);

      if (!actor.busy) {
        let intent = actor.controller ? actor.controller.update(actor, this, dt) : idleIntent();
        if (actor.stagger > 0) intent = { ...idleIntent(), face: null };
        this.apply(actor, intent, dt);
        const action = actor.action ? { kind: actor.action.kind, t: actor.action.t / actor.action.duration } : null;
        actor.body.animate(dt, actor.speed, actor.holdPose, action);
      }
      actor.updateNameplate();
    }
    this.separate();
    this.weapons.update(dt);
    this.hazards.update(dt);
  }

  private advanceAction(actor: Actor, dt: number) {
    const a = actor.action;
    if (!a) return;
    a.t += dt;
    if (!a.fired && a.t >= a.hitAt * a.duration) {
      a.fired = true;
      this.weapons.trigger(actor, a.aim);
    }
    if (a.t >= a.duration) actor.action = null;
  }

  private apply(actor: Actor, intent: Intent, dt: number) {
    const [mx, mz] = intent.move;
    const len = Math.min(1, Math.hypot(mx, mz));
    const p = actor.position;
    actor.speed = 0;
    if (len > 0.01) {
      const arch = actor.archetype;
      // Two-handed weapons slow you down a little.
      const encumbrance = actor.weapon?.spec.mount === 'chest' ? 0.85 : 1;
      const speed = (intent.run ? arch.runSpeed : arch.walkSpeed) * len * encumbrance;
      const before = p.clone();
      p.x += (mx / len) * speed * dt;
      p.z += (mz / len) * speed * dt;
      resolveWalk(p, actor.radius, this.obstacles);
      actor.speed = before.distanceTo(p) / Math.max(dt, 1e-4);
    }
    const face = intent.face ?? (actor.speed > 0.1 ? Math.atan2(-mx, -mz) : null);
    if (face !== null) actor.body.faceTowards(face, dt, intent.face !== null ? 16 : 12);

    if (intent.interact) {
      const before = actor.weapon;
      if (this.weapons.interact(actor) && actor.weapon && actor.weapon !== before) {
        this.events.emit({ type: 'pickup', actorId: actor.id, weapon: actor.weapon.spec.id });
      }
    }
    if (intent.drop && actor.weapon) {
      this.events.emit({ type: 'drop', actorId: actor.id, weapon: actor.weapon.spec.id });
      this.weapons.drop(actor);
    }
    if (intent.use && intent.aim && actor.weapon) {
      this.weapons.tryUse(actor, new THREE.Vector3(...intent.aim));
    }
  }

  /** Pushes overlapping characters apart (a busy bowler stands their ground). */
  private separate() {
    const list = [...this.members.values()].filter((a) => !a.knockedOut);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-5) continue;
        const overlap = min - d;
        const nx = dx / d;
        const nz = dz / d;
        const wa = a.busy ? 0 : b.busy ? 1 : 0.5;
        const wb = 1 - wa;
        a.position.x -= nx * overlap * wa;
        a.position.z -= nz * overlap * wa;
        b.position.x += nx * overlap * wb;
        b.position.z += nz * overlap * wb;
      }
    }
  }
}
