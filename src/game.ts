import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { APPROACH, BALL_RADIUS, LANE, MPS_TO_MPH, PIN_SPOTS, THROW, WALK } from './constants';
import { CameraRig } from './camera';
import { Input } from './input';
import { createWorld } from './physics';
import { Player, RELEASE_TIME, THROW_DURATION } from './player';
import { Scorecard, type RackAction } from './scoring';
import { UI } from './ui';
import { BALL_SPECS, Ball } from './world/ball';
import { buildHall, type Obstacle } from './world/hall';
import { Pinsetter } from './world/pins';

type State = 'free' | 'aim' | 'power' | 'spin' | 'throwing' | 'rolling' | 'settling' | 'pinsetter';

const PHYSICS_STEP = 1 / 180;
const PLAYER_RADIUS = 0.28;
/** The right hand releases the ball this far right of the body's centre line. */
const RELEASE_OFFSET_X = 0.17;
const RACK_CENTER = new THREE.Vector3(-2.3, 0, 6.4);

/** Triangle wave 0 → 1 → 0 with the given period. */
const tri01 = (t: number, period: number) => 1 - Math.abs(((t / period) * 2) % 2 - 1);
/** Triangle wave 0 → 1 → 0 → -1 → 0 with the given period. */
const triSigned = (t: number, period: number) => (2 / Math.PI) * Math.asin(Math.sin((2 * Math.PI * t) / period));

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.05, 80);
  private rig = new CameraRig(this.camera);
  private world = createWorld();
  private input: Input;
  private ui = new UI();
  private player: Player;
  private pinsetter: Pinsetter;
  private balls: Ball[];
  private obstacles: Obstacle[];
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

  private aim = { x: 0, z: 1.8, angle: 0 };
  private power = 0;
  private spin = 0;
  private meterT = 0;
  private throwT = 0;
  private throwStartZ = 0;
  private released = false;
  private foul = false;
  private rollT = 0;
  private settleT = 0;
  private standingBefore = 10;
  private strikeStreak = 0;

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
    this.obstacles = hall.obstacles;
    this.balls = BALL_SPECS.map((spec, i) => new Ball(spec, hall.rackSlots[i], this.scene, this.world));

    this.pinsetter = new Pinsetter(this.scene, this.world);
    this.pinsetter.rackAll();

    this.player = new Player(this.scene);
    this.player.position.set(0, 0, 7.6);
    this.player.yaw = 0;

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

  // ---------------------------------------------------------------- loop

  private tick(dt: number) {
    this.time += dt;
    const input = this.input;
    if (input.pressed('KeyN') && this.gameOver) this.newGame();
    if (this.state === 'free') this.rig.orbit(input.mouseDX, input.mouseDY);

    this.world.step(PHYSICS_STEP, dt, 12);
    this.pinsetter.sync();
    this.pinsetter.update(dt);
    for (const b of this.balls) b.update(dt);

    switch (this.state) {
      case 'free':
        this.updateFree(dt);
        break;
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

    this.updateAimVisuals();
    this.updateCamera(dt);
    this.updateSun();
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  // ---------------------------------------------------------------- free roam

  private updateFree(dt: number) {
    const input = this.input;
    const p = this.player.position;

    let mx = 0;
    let mz = 0;
    if (input.isDown('KeyW', 'ArrowUp')) mz -= 1;
    if (input.isDown('KeyS', 'ArrowDown')) mz += 1;
    if (input.isDown('KeyA', 'ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD', 'ArrowRight')) mx += 1;
    let speed = 0;
    if (mx || mz) {
      const len = Math.hypot(mx, mz);
      const yaw = this.rig.yaw;
      // Camera-relative movement
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const dx = (rx * mx - fx * mz) / len;
      const dz = (rz * mx - fz * mz) / len;
      speed = input.isDown('ShiftLeft', 'ShiftRight') ? 4.2 : 2.2;
      const before = p.clone();
      p.x += dx * speed * dt;
      p.z += dz * speed * dt;
      this.collide(p);
      speed = before.distanceTo(p) / Math.max(dt, 1e-4);
      this.player.faceTowards(Math.atan2(-dx, -dz), dt);
    }
    this.player.animate(dt, speed, this.held !== null);

    // Interactions
    let prompt = '';
    const nearest = this.held ? null : this.nearestRackBall();
    for (const b of this.balls) b.setHighlighted(b === nearest, this.time);

    if (nearest) {
      prompt = `<span class="kbd">E</span> pick up <b>${nearest.label}</b> · ${nearest.spec.cover} (hook ${nearest.spec.hook.toFixed(1)}×)`;
      if (this.input.pressed('KeyE')) {
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
          this.held.returnToRack(false);
          this.held = null;
        }
      } else if (!this.gameOver) {
        prompt = `Walk up to the approach of <b>lane 3</b>`;
      }
    } else if (!this.gameOver) {
      prompt = 'Get a ball from the rack';
    }
    this.ui.setPrompt(prompt);
  }

  private nearestRackBall(): Ball | null {
    const p = this.player.position;
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
    const p = this.player.position;
    return p.x > APPROACH.minX - 0.3 && p.x < APPROACH.maxX + 0.3 && p.z > APPROACH.minZ - 0.1 && p.z < APPROACH.maxZ + 0.3;
  }

  /** Keeps the player inside the hall and out of furniture. */
  private collide(p: THREE.Vector3) {
    p.x = THREE.MathUtils.clamp(p.x, WALK.minX, WALK.maxX);
    p.z = THREE.MathUtils.clamp(p.z, WALK.minZ, WALK.maxZ);
    for (const o of this.obstacles) {
      const cx = THREE.MathUtils.clamp(p.x, o.minX, o.maxX);
      const cz = THREE.MathUtils.clamp(p.z, o.minZ, o.maxZ);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER_RADIUS) {
        if (d > 1e-5) {
          p.x = cx + (dx / d) * PLAYER_RADIUS;
          p.z = cz + (dz / d) * PLAYER_RADIUS;
        } else {
          p.z = o.minZ - PLAYER_RADIUS;
        }
      }
    }
  }

  // ---------------------------------------------------------------- shot setup

  private enterAim() {
    this.state = 'aim';
    const p = this.player.position;
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
    const p = this.player.position;
    p.x = THREE.MathUtils.damp(p.x, this.aim.x, 14, dt);
    p.z = THREE.MathUtils.damp(p.z, this.aim.z, 14, dt);
    this.player.faceTowards(0, dt);
    this.player.animateStance(dt);
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
    this.power = tri01(this.meterT, 1.5);
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
    this.spin = triSigned(this.meterT, period);
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
    this.released = false;
    this.throwStartZ = this.player.position.z;
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

    const speed = THREE.MathUtils.lerp(THROW.minSpeed, THROW.maxSpeed, this.power);
    // Overpowered throws lose accuracy.
    const wobble = this.power > 0.9 ? (Math.random() * 2 - 1) * ((this.power - 0.9) / 0.1) * 0.014 : 0;
    const angle = this.aim.angle + wobble;
    const p = this.player.position;
    const pos = new THREE.Vector3(this.aim.x + RELEASE_OFFSET_X, BALL_RADIUS + 0.04, p.z - 0.4);
    const vel = new THREE.Vector3(Math.sin(angle) * speed, -0.3, -Math.cos(angle) * speed);
    ball.release(pos, vel, this.spin);

    const spinDir = Math.abs(this.spin) < 0.08 ? 'straight' : this.spin < 0 ? '◄ left' : 'right ►';
    this.ui.setThrowInfo(
      `<div>Ball <b>${ball.label}</b></div>` +
        `<div>Power <b>${Math.round(this.power * 100)}%</b> · <b>${(speed * MPS_TO_MPH).toFixed(1)} mph</b></div>` +
        `<div>Spin <b>${Math.abs(this.spin).toFixed(2)} ${spinDir}</b> · rev rate <b>${Math.round(150 + Math.abs(this.spin) * 350 * ball.spec.hook)} rpm</b></div>` +
        (wobble ? `<div style="color:#f87171">Overpowered! Release was off line.</div>` : '') +
        `<div id="live-speed"></div>`,
    );
  }

  private updateThrowAndRoll(dt: number) {
    if (this.throwT < THROW_DURATION) {
      this.throwT += dt;
      const frac = this.player.animateThrow(Math.min(this.throwT, THROW_DURATION));
      this.player.position.z = this.throwStartZ - frac * THROW.slideDistance;
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

  private updateAimVisuals() {
    const aiming = this.state === 'aim' || this.state === 'power' || this.state === 'spin';
    this.aimLine.visible = aiming;
    this.slideMarker.visible = aiming;
    if (!aiming) return;
    const startZ = this.player.position.z - THROW.slideDistance - 0.4;
    const x = this.aim.x + RELEASE_OFFSET_X;
    this.aimLine.position.set(x, 0.004, startZ);
    this.aimLine.rotation.y = -this.aim.angle;
    this.aimLine.scale.z = 6.5 - startZ;

    const toe = this.player.position.z - THROW.slideDistance - 0.17;
    this.slideMarker.position.set(this.aim.x - 0.1, 0.003, toe + 0.13);
    (this.slideMarker.material as THREE.MeshBasicMaterial).color.set(toe < 0 ? '#ef4444' : '#4ade80');
  }

  private updateCamera(dt: number) {
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    let rate = 18;
    const p = this.player.position;

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
        const tp = this.rig.thirdPerson(p);
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
      this.state === 'rolling' && this.thrown ? this.thrown.mesh.position : this.state === 'settling' || this.state === 'pinsetter' ? new THREE.Vector3(0, 0, -16) : this.player.position;
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
