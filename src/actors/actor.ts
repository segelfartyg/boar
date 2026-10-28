import * as THREE from 'three';
import { ARCHETYPES, type Archetype, type ArchetypeId } from '../characters/archetypes';
import { Humanoid, type ActionKind, type HoldPose } from '../characters/humanoid';
import type { WeaponItem } from '../weapons/weapons';
import type { Controller } from './controllers';

/** The bowler of the current round, or someone trying to ruin it. */
export type Role = 'bowler' | 'saboteur';

export interface ActiveAction {
  kind: ActionKind;
  t: number;
  duration: number;
  hitAt: number;
  fired: boolean;
  aim: THREE.Vector3;
}

let nextId = 1;

/**
 * Anything with a body in the arena: the local bowler, AI saboteurs and,
 * later, remote players. All of them are driven the same way: a Controller
 * produces an Intent each tick and the Arena applies it.
 */
export class Actor {
  readonly id: string;
  readonly archetype: Archetype;
  readonly body: Humanoid;
  readonly radius: number;
  name: string;
  role: Role;
  controller: Controller | null;
  hp: number;
  weapon: WeaponItem | null = null;
  /** Set by the bowling sequence while it holds the body (aiming, throwing…). */
  busy = false;
  carryingBall = false;
  /** Seconds left of being dazed; can't move or act. */
  stagger = 0;
  /** Seconds since knocked out (-1 when standing). */
  koTime = -1;
  /** Time since last hit, for composure regeneration. */
  sinceHit = 99;
  readonly knock = new THREE.Vector3();
  cooldown = 0;
  action: ActiveAction | null = null;
  /** Horizontal speed this tick, for the walk cycle. */
  speed = 0;
  private nameplate: THREE.Sprite;
  private plateCanvas: HTMLCanvasElement;
  private plateKey = '';

  constructor(scene: THREE.Scene, archetypeId: ArchetypeId, role: Role, controller: Controller | null, id?: string) {
    this.id = id ?? `a${nextId++}`;
    this.archetype = ARCHETYPES[archetypeId];
    this.name = this.archetype.name;
    this.role = role;
    this.controller = controller;
    this.hp = this.archetype.maxHp;
    this.radius = this.archetype.radius;
    this.body = new Humanoid(scene, this.archetype.look);

    this.plateCanvas = document.createElement('canvas');
    this.plateCanvas.width = 256;
    this.plateCanvas.height = 64;
    const tex = new THREE.CanvasTexture(this.plateCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.nameplate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.nameplate.scale.set(0.8, 0.2, 1);
    this.nameplate.renderOrder = 10;
    this.nameplate.visible = role !== 'bowler';
    scene.add(this.nameplate);
  }

  get position() {
    return this.body.position;
  }

  get knockedOut() {
    return this.koTime >= 0;
  }

  get maxHp() {
    return this.archetype.maxHp;
  }

  get holdPose(): HoldPose {
    if (this.weapon) return this.weapon.spec.hold;
    return this.carryingBall ? 'ball' : 'none';
  }

  /** Top of the head, for aiming and nameplates. */
  get height() {
    return 1.72 * this.body.h;
  }

  updateNameplate() {
    const p = this.position;
    this.nameplate.position.set(p.x, this.height + 0.28 - (this.knockedOut ? this.height * 0.8 : 0), p.z);
    const key = `${Math.ceil(this.hp)}|${this.weapon?.spec.name ?? ''}|${this.knockedOut}`;
    if (key === this.plateKey) return;
    this.plateKey = key;
    const g = this.plateCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.font = 'bold 26px "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.fillStyle = this.knockedOut ? '#888' : '#ffd1ea';
    g.shadowColor = '#000';
    g.shadowBlur = 6;
    g.fillText(this.knockedOut ? `${this.name} 💫` : this.name, 128, 28);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(48, 40, 160, 12);
    const f = Math.max(0, this.hp / this.maxHp);
    g.fillStyle = f > 0.5 ? '#4ade80' : f > 0.25 ? '#facc15' : '#ef4444';
    g.fillRect(50, 42, 156 * f, 8);
    (this.nameplate.material.map as THREE.Texture).needsUpdate = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.body.root);
    scene.remove(this.nameplate);
  }
}
