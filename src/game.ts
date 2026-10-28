import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Actor } from './actors/actor';
import { Arena, type BowlingPhase } from './actors/arena';
import { LocalController } from './actors/controllers';
import type { GameEvent } from './actors/events';
import { CameraRig } from './camera';
import { ENEMY_ARCHETYPES } from './characters/archetypes';
import { RELEASE_TIME, THROW_DURATION, type Humanoid } from './characters/humanoid';
import { APPROACH, BALL_RADIUS, LANE, MPS_TO_MPH, PIN_SPOTS, THROW } from './constants';
import { Effects } from './fx/effects';
import { sfx } from './fx/sfx';
import { Input } from './input';
import { createWorld } from './physics';
import { Scorecard, type RackAction } from './scoring';
import { UI } from './ui';
import { WEAPONS, type WeaponSpec } from './weapons/specs';
import { BALL_SPECS, Ball } from './world/ball';
import { buildHall } from './world/hall';
import type { HazardKind } from './world/hazards';
import { Pinsetter } from './world/pins';

type State = 'free' | 'aim' | 'power' | 'spin' | 'throwing' | 'rolling' | 'settling' | 'pinsetter';

const PHYSICS_STEP = 1 / 180;
/** The right hand releases the ball this far right of the body's centre line. */
const RELEASE_OFFSET_X = 0.17;
const RACK_CENTER = new THREE.Vector3(-2.3, 0, 6.4);
/** Saboteurs closer than this rattle the bowler. */
const FEAR_RADIUS = 4.5;

const WEAPON_ICON: Record<string, string> = { ak47: '🔫', bat: '🏏', cheese: '🧀', confetti: '🎉', hazard: '💀' };

/** Triangle wave 0 → 1 → 0 with the given period. */
const tri01 = (t: number, period: number) => 1 - Math.abs(((t / period) * 2) % 2 - 1);
/** Triangle wave 0 → 1 → 0 → -1 → 0 with the given period. */
const triSigned = (t: number, period: number) => (2 / Math.PI) * Math.asin(Math.sin((2 * Math.PI * t) / period));
const rnd = () => Math.random() * 2 - 1;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
  private rig = new CameraRig(this.camera);
  private world = createWorld();
  private input: Input;
  private ui = new UI();
  private fx: Effects;
  private arena: Arena;
  private bowler: Actor;
  private local: LocalController;
  private pinsetter: Pinsetter;
  private balls: Ball[];
  private sun: THREE.DirectionalLight;
  private aimLine: THREE.Mesh;
  private slideMarker: THREE.Mesh;
  private scorecard = new Scorecard();

  private state: State = 'free';
  private held: Ball | null = null;
  private thrown: Ball | null = null;
  private gameOver = false;
  private time = 0;
  private camRate = 3;
  private hudT = 0;

  private aim = { x: 0, z: 1.8, angle: 0 };
  private power = 0;
  private spin = 0;
  private meterT = 0;
  private throwT = 0;
  private throwStartZ = 0;
  private released = false;
  private foul = false;
  /** Accumulated damage to the throw from hits during the approach. */
  private throwDisrupt = 0;
  /** How rattled the bowler is by saboteurs nearby (0 = calm). */
  private fear = 0;
  private rollT = 0;
  private settleT = 0;
  private standingBefore = 10;
  private strikeStreak = 0;
  private feedThrottle = new Map<string, number>();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.input = new Input(this.renderer.domElement);

    const hall = buildHall(this.scene, this.world);
    this.balls = BALL_SPECS.map((spec, i) => new Ball(spec, hall.rackSlots[i], this.scene, this.world));

    this.pinsetter = new Pinsetter(this.scene, this.world);
    this.pinsetter.rackAll();

    this.fx = new Effects(this.scene);
    this.arena = new Arena(this.scene, this.world, this.fx, hall.obstacles, {
      phase: () => this.phase,
      rollingBall: () => (this.thrown?.state === 'rolling' ? this.thrown : null),
      pins: () => this.pinsetter.pins,
      listener: () => this.camera.position,
    });
    this.local = new LocalController(this.input, this.rig, () => this.aimPoint());
    this.bowler = this.arena.join('bowler', 'bowler', this.local, new THREE.Vector3(0, 0, 7.6));
    this.arena.events.on((e) => this.onArenaEvent(e));

    this.sun = new THREE.DirectionalLight('#fff0e0', 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    sc.near = 0.5;
    sc.far = 25;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.aimLine = this.createAimLine();
    this.slideMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 0.26).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.slideMarker.visible = false;
    this.scene.add(this.slideMarker);

    // Hook model is applied before every physics sub-step.
    this.world.addEventListener('preStep', () => this.thrown?.applyLaneForces());

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') this.ui.toggleHelp();
    });
    document.getElementById('new-game')!.addEventListener('click', () => this.newGame());
    document.getElementById('start-btn')!.addEventListener('click', () => {
      document.getElementById('start')!.classList.add('hidden');
      sfx.unlock();
      this.input.lock();
    });

    this.resize();
    this.ui.renderScoreboard(this.scorecard, true);
    this.ui.renderPins(new Set(PIN_SPOTS.map((_, i) => i + 1)));

    const timer = new THREE.Timer();
    timer.connect(document);
    this.renderer.setAnimationLoop((t) => {
      timer.update(t);
      this.tick(Math.min(timer.getDelta(), 1 / 20));
    });
  }

  /** The bowler's body (the bowling sequence animates it directly). */
  private get player(): Humanoid {
    return this.bowler.body;
  }

  private get phase(): BowlingPhase {
    switch (this.state) {
      case 'aim':
      case 'power':
      case 'spin':
        return 'aiming';
      case 'throwing':
        return 'throwing';
      case 'rolling':
        return 'rolling';
      case 'settling':
      case 'pinsetter':
        return 'resetting';
      default:
        return 'idle';
    }
  }

  private createAimLine(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 16, 40);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 22);
    const geo = new THREE.PlaneGeometry(0.025, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: '#facc15', map: tex, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private newGame() {
    this.scorecard.reset();
    this.gameOver = false;
    this.strikeStreak = 0;
    this.ui.showGameOver(null);
    this.ui.renderScoreboard(this.scorecard, true);
    this.ui.setThrowInfo('');
    this.input.lock();
  }

  /** Where the crosshair points: the first thing hit along the camera's view ray. */
  private aimPoint(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return this.arena.weapons.castRay(this.camera.position.clone(), dir, 60, this.bowler).point;
  }

  // ---------------------------------------------------------------- loop

  private tick(dt: number) {
    this.time += dt;
    const input = this.input;
    if (input.pressed('KeyN') && this.gameOver) this.newGame();
    if (this.state === 'free') this.rig.orbit(input.mouseDX, input.mouseDY);
    this.handleSpawnKeys();

    this.world.step(PHYSICS_STEP, dt, 12);
    this.pinsetter.sync();
    this.pinsetter.update(dt);
    for (const b of this.balls) b.update(dt);

    this.updateFear();
    this.bowler.carryingBall = this.held !== null;
    this.bowler.busy = this.state !== 'free';
    if (this.state === 'free') this.updateFree();

    this.arena.update(dt);
    this.fx.update(dt);

    switch (this.state) {
      case 'aim':
        this.updateAim(dt);
        break;
      case 'power':
        this.updatePower(dt);
        break;
      case 'spin':
        this.updateSpin(dt);
        break;
      case 'throwing':
      case 'rolling':
        this.updateThrowAndRoll(dt);
        break;
      case 'settling':
        this.updateSettling(dt);
        break;
      case 'pinsetter':
        this.player.animate(dt, 0, false);
        break;
    }

    this.updateHud(dt);
    this.updateAimVisuals();
    this.updateCamera(dt);
    this.updateSun();
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  private handleSpawnKeys() {
    const input = this.input;
    ENEMY_ARCHETYPES.forEach((id, i) => {
      if (input.pressed(`Digit${i + 1}`, `Numpad${i + 1}`)) this.arena.spawnSaboteur(id);
    });
    const hazard = (kind: HazardKind) => {
      this.arena.hazards.spawn(kind);
      this.arena.events.emit({ type: 'hazard', kind });
    };
    if (input.pressed('Digit4', 'Numpad4')) hazard('tombstone');
    if (input.pressed('Digit5', 'Numpad5')) hazard('spider');
    if (input.pressed('Digit0', 'Numpad0')) {
      this.arena.clearSaboteurs();
      this.ui.feed('Everyone was kicked out of the hall');
    }
  }

  // ---------------------------------------------------------------- saboteur pressure

  /** Armed saboteurs close by make the bowler (and the camera, and the meters) shake. */
  private updateFear() {
    let fear = 0;
    const p = this.bowler.position;
    for (const a of this.arena.members.values()) {
      if (a.role !== 'saboteur' || a.knockedOut) continue;
      const d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
      if (d < FEAR_RADIUS) fear += (1 - d / FEAR_RADIUS) * (a.weapon ? 1 : 0.5);
    }
    // Low composure makes everything worse.
    const composure = this.bowler.hp / this.bowler.maxHp;
    this.fear = Math.min(1.5, fear * (1.5 - composure * 0.5));
    if (this.fear > 0.05) {
      this.player.setTremble(Math.min(0.85, this.fear * 0.55));
      if (this.phase === 'aiming' || this.phase === 'throwing') this.rig.holdTrauma(Math.min(0.4, this.fear * 0.2));
    }
  }

  private onArenaEvent(e: GameEvent) {
    const name = (id: string | null) => (id ? `<b>${this.arena.members.get(id)?.name ?? '?'}</b>` : 'Something');
    const throttled = (key: string, seconds: number) => {
      const last = this.feedThrottle.get(key) ?? -99;
      if (this.time - last < seconds) return true;
      this.feedThrottle.set(key, this.time);
      return false;
    };
    switch (e.type) {
      case 'spawn': {
        const a = this.arena.members.get(e.actorId);
        if (a?.role === 'saboteur') this.ui.feed(`${name(e.actorId)} entered the hall 😈`);
        break;
      }
      case 'pickup':
        this.ui.feed(`${name(e.actorId)} grabbed the <b>${WEAPONS[e.weapon].name}</b> ${WEAPON_ICON[e.weapon]}`);
        break;
      case 'hit': {
        const involvesYou = e.targetId === this.bowler.id || e.attackerId === this.bowler.id;
        if (involvesYou && !throttled(`hit:${e.attackerId}:${e.targetId}`, e.weapon === 'ak47' ? 1.5 : 0.3)) {
          this.ui.feed(`${name(e.attackerId)} ${WEAPON_ICON[e.weapon]} ${name(e.targetId)}`);
        }
        if (e.targetId === this.bowler.id && e.weapon !== 'hazard') this.onBowlerHit(WEAPONS[e.weapon]);
        break;
      }
      case 'knockout':
        this.ui.feed(`${name(e.byId)} knocked out ${name(e.actorId)} 💫`);
        break;
      case 'ballHit':
        if (!throttled(`ball:${e.attackerId}`, 1.5)) this.ui.feed(`${name(e.attackerId)} ${WEAPON_ICON[e.weapon]} hit your <b>ball</b>!`);
        break;
      case 'hazard':
        this.ui.feed(e.kind === 'tombstone' ? 'A <b>tombstone</b> rises from the lane 💀' : 'A <b>giant spider</b> drops onto the lane 🕷️');
        break;
    }
  }

  /** The local bowler got hit: shake, splat, and wreck whatever shot they were lining up. */
  private onBowlerHit(spec: WeaponSpec) {
    this.rig.addTrauma(spec.trauma);
    if (spec.id === 'cheese') this.ui.screenFx('cheese');
    else if (spec.id === 'confetti') this.ui.screenFx('confetti');
    else this.ui.screenFx('hit', spec.disrupt);

    const composure = this.bowler.hp / this.bowler.maxHp;
    const d = spec.disrupt * (1.4 - composure * 0.4);
    const knockedOff = spec.disrupt >= 0.9;
    switch (this.state) {
      case 'aim':
      case 'power':
      case 'spin':
        if (knockedOff) {
          this.exitAim();
          this.bowler.stagger = 1.0;
          this.ui.showMessage('KNOCKED OFF!', 'shake it off', 'bad');
          return;
        }
        this.aim.angle = THREE.MathUtils.clamp(this.aim.angle + rnd() * 0.03 * d, -THROW.maxAimAngle, THROW.maxAimAngle);
        this.aim.x = THREE.MathUtils.clamp(this.aim.x + rnd() * 0.1 * d, APPROACH.minX, APPROACH.maxX);
        // Meters jump around.
        this.meterT += Math.random() * 0.6 * d;
        break;
      case 'throwing':
        if (!this.released) {
          this.throwDisrupt += d;
          if (this.throwDisrupt > 0.5) this.ui.showMessage('SHOT RUINED!', 'mid-approach hit', 'bad');
        }
        break;
    }
  }

  // ---------------------------------------------------------------- free roam

  /** Ball handling and prompts; movement and weapons go through the arena like everyone else. */
  private updateFree() {
    const input = this.input;
    const p = this.bowler.position;
    const weapons = this.arena.weapons;

    let prompt = '';
    const nearest = this.held ? null : this.nearestRackBall();
    for (const b of this.balls) b.setHighlighted(b === nearest, this.time);
    const nearWeapon = this.held ? null : weapons.nearestPickup(this.bowler);
    const ballCloser = nearest && (!nearWeapon || nearest.slot.distanceTo(p) < nearWeapon.position.distanceTo(p));

    if (nearest && ballCloser) {
      prompt = `<span class="kbd">E</span> pick up <b>${nearest.label}</b> · ${nearest.spec.cover} (hook ${nearest.spec.hook.toFixed(1)}×)`;
      if (input.pressed('KeyE')) {
        this.local.suppressInteract = true;
        if (this.bowler.weapon) weapons.drop(this.bowler);
        this.held = nearest;
        nearest.attachTo(this.player.rightHand);
      }
    } else if (this.held) {
      const nearRack = Math.hypot(p.x - RACK_CENTER.x, p.z - RACK_CENTER.z) < 1.4;
      if (this.inApproach() && !this.gameOver) {
        prompt = `<span class="kbd">Space</span> step up and aim`;
        if (input.action) this.enterAim();
      } else if (nearRack) {
        prompt = `<span class="kbd">E</span> put back the ${this.held.label}`;
        if (input.pressed('KeyE')) {
          this.local.suppressInteract = true;
          this.held.returnToRack(false);
          this.held = null;
        }
      } else if (!this.gameOver) {
        prompt = `Walk up to the approach of <b>lane 3</b>`;
      }
    } else if (nearWeapon) {
      prompt = `<span class="kbd">E</span> grab <b>${nearWeapon.spec.name}</b> · ${nearWeapon.spec.blurb}`;
    } else if (this.bowler.weapon) {
      const w = this.bowler.weapon.spec;
      prompt = weapons.nearStand(this.bowler)
        ? `<span class="kbd">E</span> hang the ${w.name} back`
        : `<span class="kbd">Click</span> use ${w.name} · <span class="kbd">G</span> drop · grab a ball to bowl`;
    } else if (!this.gameOver) {
      prompt = 'Get a ball from the rack';
    }
    this.ui.setPrompt(prompt);
  }

  private nearestRackBall(): Ball | null {
    const p = this.bowler.position;
    let best: Ball | null = null;
    let bestD = 0.95;
    for (const b of this.balls) {
      if (b.state !== 'rack') continue;
      const d = Math.hypot(b.slot.x - p.x, b.slot.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private inApproach() {
    const p = this.bowler.position;
    return p.x > APPROACH.minX - 0.3 && p.x < APPROACH.maxX + 0.3 && p.z > APPROACH.minZ - 0.1 && p.z < APPROACH.maxZ + 0.3;
  }

  // ---------------------------------------------------------------- shot setup

  private enterAim() {
    this.state = 'aim';
    const p = this.bowler.position;
    this.aim.x = THREE.MathUtils.clamp(p.x, APPROACH.minX, APPROACH.maxX);
    this.aim.z = THREE.MathUtils.clamp(p.z, APPROACH.minZ, APPROACH.maxZ);
    this.aim.angle = 0;
    this.ui.setThrowInfo('');
  }

  private exitAim() {
    this.state = 'free';
    this.ui.showPower(false);
    this.ui.showSpin(false);
    this.rig.yaw = 0;
    this.rig.pitch = -0.22;
  }

  private positionAtAim(dt: number) {
    const p = this.bowler.position;
    p.x = THREE.MathUtils.damp(p.x, this.aim.x, 14, dt);
    p.z = THREE.MathUtils.damp(p.z, this.aim.z, 14, dt);
    this.player.faceTowards(0, dt);
    this.player.animateStance(dt);
  }

  /** Nervous jitter added to the meters while saboteurs are close. */
  private jitter(freq: number) {
    return Math.sin(this.time * freq) * Math.sin(this.time * freq * 1.37 + 0.7) * this.fear;
  }

  private updateAim(dt: number) {
    const input = this.input;
    const a = this.aim;
    if (input.isDown('KeyA', 'ArrowLeft')) a.x -= 0.45 * dt;
    if (input.isDown('KeyD', 'ArrowRight')) a.x += 0.45 * dt;
    if (input.isDown('KeyW', 'ArrowUp')) a.z -= 0.9 * dt;
    if (input.isDown('KeyS', 'ArrowDown')) a.z += 0.9 * dt;
    if (input.isDown('KeyQ')) a.angle -= 0.05 * dt;
    if (input.isDown('KeyE')) a.angle += 0.05 * dt;
    a.angle += input.mouseDX * 0.00018;
    // Shaky hands drift the aim.
    a.angle += this.jitter(3.1) * 0.02 * dt;
    a.x = THREE.MathUtils.clamp(a.x, APPROACH.minX, APPROACH.maxX);
    a.z = THREE.MathUtils.clamp(a.z, APPROACH.minZ, APPROACH.maxZ);
    a.angle = THREE.MathUtils.clamp(a.angle, -THROW.maxAimAngle, THROW.maxAimAngle);
    this.positionAtAim(dt);

    const board = Math.round((LANE.halfWidth - (a.x + RELEASE_OFFSET_X)) / (LANE.width / LANE.boards) + 0.5);
    const deg = THREE.MathUtils.radToDeg(a.angle);
    this.ui.setPrompt(
      `Board <b>${THREE.MathUtils.clamp(board, 1, 39)}</b> · angle <b>${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°</b> &nbsp;|&nbsp; ` +
        `<span class="kbd">A D</span> shift <span class="kbd">W S</span> step <span class="kbd">Q E</span>/mouse angle ` +
        `<span class="kbd">Space</span> go <span class="kbd">Esc</span> back`,
    );

    if (input.cancel) this.exitAim();
    else if (input.action) {
      this.state = 'power';
      this.meterT = 0;
      this.ui.showPower(true);
      this.ui.setPower(0);
    }
  }

  private updatePower(dt: number) {
    this.positionAtAim(dt);
    this.meterT += dt;
    this.power = THREE.MathUtils.clamp(tri01(this.meterT, 1.5) + this.jitter(9) * 0.07, 0, 1);
    this.ui.setPower(this.power);
    this.ui.setPrompt(`<span class="kbd">Space</span> lock <b>power</b> — green is the sweet spot, red costs accuracy`);
    if (this.input.cancel) {
      this.ui.showPower(false);
      this.state = 'aim';
    } else if (this.input.action) {
      this.ui.setPower(this.power, true);
      this.state = 'spin';
      this.meterT = 0;
      this.ui.showSpin(true);
      this.ui.setSpin(0);
    }
  }

  private updateSpin(dt: number) {
    this.positionAtAim(dt);
    this.meterT += dt;
    // A harder throw makes the spin needle harder to control.
    const period = 2.0 - 0.9 * this.power;
    this.spin = THREE.MathUtils.clamp(triSigned(this.meterT, period) + this.jitter(11) * 0.12, -1, 1);
    this.ui.setSpin(this.spin);
    this.ui.setPrompt(`<span class="kbd">Space</span> lock <b>spin</b> — centre rolls straight, edges hook hard`);
    if (this.input.cancel) {
      this.ui.showSpin(false);
      this.ui.showPower(false);
      this.state = 'aim';
    } else if (this.input.action) {
      this.ui.setSpin(this.spin, true);
      this.startThrow();
    }
  }

  // ---------------------------------------------------------------- the shot

  private startThrow() {
    this.state = 'throwing';
    this.throwT = 0;
    this.throwDisrupt = 0;
    this.released = false;
    this.throwStartZ = this.bowler.position.z;
    this.foul = this.throwStartZ - THROW.slideDistance - 0.17 < 0;
    this.standingBefore = this.pinsetter.standingPins().length;
    this.ui.setPrompt('');
    window.setTimeout(() => {
      this.ui.showPower(false);
      this.ui.showSpin(false);
    }, 700);
  }

  private release() {
    const ball = this.held!;
    this.held = null;
    this.thrown = ball;
    this.released = true;

    // Hits during the approach wreck power, line and spin.
    const td = Math.min(1.5, this.throwDisrupt);
    const power = Math.max(0.05, this.power * (1 - 0.35 * td));
    const spin = THREE.MathUtils.clamp(this.spin + rnd() * 1.2 * td, -1, 1);
    const speed = THREE.MathUtils.lerp(THROW.minSpeed, THROW.maxSpeed, power);
    // Overpowered throws lose accuracy.
    const wobble = this.power > 0.9 ? rnd() * ((this.power - 0.9) / 0.1) * 0.014 : 0;
    const angle = this.aim.angle + wobble + rnd() * 0.06 * td;
    const p = this.bowler.position;
    const pos = new THREE.Vector3(this.aim.x + RELEASE_OFFSET_X, BALL_RADIUS + 0.04, p.z - 0.4);
    const vel = new THREE.Vector3(Math.sin(angle) * speed, -0.3, -Math.cos(angle) * speed);
    ball.release(pos, vel, spin);

    const spinDir = Math.abs(spin) < 0.08 ? 'straight' : spin < 0 ? '◄ left' : 'right ►';
    this.ui.setThrowInfo(
      `<div>Ball <b>${ball.label}</b></div>` +
        `<div>Power <b>${Math.round(power * 100)}%</b> · <b>${(speed * MPS_TO_MPH).toFixed(1)} mph</b></div>` +
        `<div>Spin <b>${Math.abs(spin).toFixed(2)} ${spinDir}</b> · rev rate <b>${Math.round(150 + Math.abs(spin) * 350 * ball.spec.hook)} rpm</b></div>` +
        (wobble ? `<div style="color:#f87171">Overpowered! Release was off line.</div>` : '') +
        (td > 0.05 ? `<div style="color:#f87171">Hit mid-approach! Shot ${Math.round(Math.min(1, td) * 100)}% ruined.</div>` : '') +
        `<div id="live-speed"></div>`,
    );
  }

  private updateThrowAndRoll(dt: number) {
    if (this.throwT < THROW_DURATION) {
      this.throwT += dt;
      const frac = this.player.animateThrow(Math.min(this.throwT, THROW_DURATION));
      this.bowler.position.z = this.throwStartZ - frac * THROW.slideDistance;
      if (!this.released && this.throwT >= RELEASE_TIME) {
        this.release();
        this.state = 'rolling';
        this.rollT = 0;
      }
    } else {
      this.player.animate(dt, 0, false);
    }
    if (this.state !== 'rolling') return;

    const ball = this.thrown!;
    this.rollT += dt;
    const live = document.getElementById('live-speed');
    if (live) live.innerHTML = `Live <b>${(ball.speed * MPS_TO_MPH).toFixed(1)} mph</b>${ball.inGutter ? ' · <span style="color:#f87171">in the gutter</span>' : ''}`;

    const z = ball.body.position.z;
    const done = z < -LANE.length - 0.25 || ball.body.position.y < -0.3 || (ball.speed < 0.15 && this.rollT > 1.5) || this.rollT > 12;
    if (done) {
      this.state = 'settling';
      this.settleT = 0;
    }
  }

  private updateSettling(dt: number) {
    if (this.throwT < THROW_DURATION) {
      this.throwT += dt;
      this.player.animateThrow(this.throwT);
    } else {
      this.player.animate(dt, 0, false);
    }
    this.settleT += dt;
    if ((this.settleT > 1.6 && !this.pinsetter.anyMoving()) || this.settleT > 5) this.scoreShot();
  }

  private scoreShot() {
    const fresh = this.scorecard.freshRack;
    const standing = this.pinsetter.standingPins();
    const standingNumbers = new Set(standing.map((p) => p.number));
    let knocked = Math.max(0, this.standingBefore - standing.length);
    const split = fresh && !this.foul && isSplit(standingNumbers);
    if (this.foul) knocked = 0;

    let action: RackAction = this.scorecard.addRoll({ pins: knocked, foul: this.foul, split });
    // After a foul the knocked pins are respotted.
    if (this.foul && action === 'sweep') action = 'reset';

    // Feedback
    const ball = this.thrown!;
    if (this.foul) {
      this.strikeStreak = 0;
      this.ui.showMessage('FOUL', 'stepped over the line', 'bad');
    } else if (fresh && knocked === 10) {
      this.strikeStreak++;
      const names = ['STRIKE!', 'DOUBLE!', 'TURKEY!'];
      this.ui.showMessage(names[this.strikeStreak - 1] ?? `${this.strikeStreak}-BAGGER!`, 'all ten', 'strike');
    } else if (!fresh && standing.length === 0) {
      this.strikeStreak = 0;
      this.ui.showMessage('SPARE!', `picked up ${knocked}`, 'spare');
    } else {
      this.strikeStreak = 0;
      if (knocked === 0 && ball.inGutter) this.ui.showMessage('GUTTER', 'ouch', 'bad');
      else if (split) this.ui.showMessage('SPLIT!', `${knocked} pins · ${[...standingNumbers].sort((a, b) => a - b).join('-')} left`, 'bad');
      else this.ui.showMessage(String(knocked), knocked === 1 ? 'pin' : 'pins');
    }

    this.ui.renderPins(standingNumbers);
    this.ui.renderScoreboard(this.scorecard, true);

    this.state = 'pinsetter';
    this.arena.weapons.clearLane();
    this.pinsetter.start(action === 'sweep' ? 'sweep' : 'reset', () => {
      ball.returnToRack(true);
      this.thrown = null;
      this.state = 'free';
      this.camRate = 2.5;
      this.rig.yaw = 0;
      this.rig.pitch = -0.22;
      if (action !== 'sweep') this.ui.renderPins(new Set(PIN_SPOTS.map((_, i) => i + 1)));
      if (action === 'gameover') {
        this.gameOver = true;
        this.ui.renderScoreboard(this.scorecard, false);
        this.ui.showGameOver(this.scorecard.currentTotal());
        document.exitPointerLock();
      }
    });
  }

  // ---------------------------------------------------------------- visuals

  private updateHud(dt: number) {
    const armed = this.state === 'free' && this.bowler.weapon !== null;
    this.ui.showCrosshair(armed);
    const item = this.bowler.weapon;
    if (item) {
      const s = item.spec;
      const status = item.reloadT > 0 ? 'reloading…' : s.magazine ? `${item.ammo} / ${s.magazine}` : s.consumable ? 'throw it!' : this.bowler.cooldown > 0 ? 'recharging…' : 'ready';
      this.ui.setWeaponHud(`<div>${WEAPON_ICON[s.id]} <b>${s.name}</b></div><div class="sub">${status}</div>`);
    } else {
      this.ui.setWeaponHud('');
    }
    this.ui.setComposure(this.bowler.hp / this.bowler.maxHp, this.fear > 0.3);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      const list = [...this.arena.members.values()];
      this.ui.renderRoster(list.length > 1 ? list : []);
    }
  }

  private updateAimVisuals() {
    const aiming = this.state === 'aim' || this.state === 'power' || this.state === 'spin';
    this.aimLine.visible = aiming;
    this.slideMarker.visible = aiming;
    if (!aiming) return;
    const startZ = this.bowler.position.z - THROW.slideDistance - 0.4;
    const x = this.aim.x + RELEASE_OFFSET_X;
    this.aimLine.position.set(x, 0.004, startZ);
    this.aimLine.rotation.y = -this.aim.angle;
    this.aimLine.scale.z = 6.5 - startZ;

    const toe = this.bowler.position.z - THROW.slideDistance - 0.17;
    this.slideMarker.position.set(this.aim.x - 0.1, 0.003, toe + 0.13);
    (this.slideMarker.material as THREE.MeshBasicMaterial).color.set(toe < 0 ? '#ef4444' : '#4ade80');
  }

  private updateCamera(dt: number) {
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    let rate = 18;
    const p = this.bowler.position;

    switch (this.state) {
      case 'aim':
      case 'power':
      case 'spin':
      case 'throwing': {
        const a = this.aim;
        // Over the right shoulder, so the aim line isn't hidden by the bowler.
        pos = new THREE.Vector3(a.x + 0.75, 1.95, p.z + 2.2);
        look = new THREE.Vector3(a.x + RELEASE_OFFSET_X + Math.sin(a.angle) * 10, 0.0, p.z - 10);
        rate = 6;
        break;
      }
      case 'rolling': {
        const b = this.thrown!.mesh.position;
        const camZ = Math.max(b.z, -13.6) + 2.4;
        pos = new THREE.Vector3(b.x * 0.6, 0.85, camZ);
        const toPins = THREE.MathUtils.smoothstep(-b.z, 10, 15);
        look = new THREE.Vector3(b.x, 0.12, b.z - 4).lerp(new THREE.Vector3(0, 0.2, -18.5), toPins);
        rate = 5;
        break;
      }
      case 'settling':
      case 'pinsetter':
        pos = new THREE.Vector3(0, 1.0, -14.2);
        look = new THREE.Vector3(0, 0.3, -18.6);
        rate = 3;
        break;
      default: {
        const tp = this.rig.thirdPerson(p, this.bowler.weapon ? 0.55 : 0);
        pos = tp.pos;
        look = tp.look;
        this.camRate = THREE.MathUtils.damp(this.camRate, 18, 1.5, dt);
        rate = this.camRate;
      }
    }
    this.rig.update(pos, look, dt, rate);
  }

  /** Keeps the shadow-casting light centred on whatever we are looking at. */
  private updateSun() {
    const focus =
      this.state === 'rolling' && this.thrown ? this.thrown.mesh.position : this.state === 'settling' || this.state === 'pinsetter' ? new THREE.Vector3(0, 0, -16) : this.bowler.position;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(new THREE.Vector3(2.5, 9, 3));
  }
}

/** A split: headpin down and the remaining pins form two or more separate groups. */
function isSplit(standing: Set<number>): boolean {
  if (standing.has(1) || standing.size < 2) return false;
  const nums = [...standing];
  const seen = new Set<number>([nums[0]]);
  const queue = [nums[0]];
  while (queue.length) {
    const n = queue.pop()!;
    const a = PIN_SPOTS[n - 1];
    for (const m of nums) {
      if (seen.has(m)) continue;
      const b = PIN_SPOTS[m - 1];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 0.31) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return seen.size < nums.length;
}
