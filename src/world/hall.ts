import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DECOR_LANES, HALL, LANE, LANE_SPACING, PIN_SPOTS } from '../constants';
import { materials } from '../physics';
import { carpetTexture, laneNumberTexture, laneWoodTexture, maskingTexture } from '../textures';
import { createPinMesh } from './pins';

/** Axis-aligned obstacle on the floor, used for player collision. */
export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Hall {
  rackSlots: THREE.Vector3[];
  obstacles: Obstacle[];
}

const FT = 0.3048;
const BOARD = LANE.width / LANE.boards;
const boardX = (board: number) => -LANE.halfWidth + (board - 0.5) * BOARD;

function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
}

function box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function staticBox(world: CANNON.World, material: CANNON.Material, hx: number, hy: number, hz: number, x: number, y: number, z: number) {
  const body = new CANNON.Body({ mass: 0, material, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
  body.position.set(x, y, z);
  world.addBody(body);
}

// Shared lane materials
const laneMat = new THREE.MeshStandardMaterial({ map: laneWoodTexture(LANE.length / 1.4), roughness: 0.12, metalness: 0 });
const deckMat = new THREE.MeshStandardMaterial({ map: laneWoodTexture(1, 6), roughness: 0.2 });
const approachMat = new THREE.MeshStandardMaterial({ map: laneWoodTexture(LANE.approachLength / 1.4, -4), roughness: 0.3 });
const gutterMat = mat('#9aa3b2', { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
const markMat = mat('#3b1d0c', { roughness: 0.4 });
const capMat = mat('#1b1530', { roughness: 0.4 });
const pitMat = mat('#050308', { roughness: 1 });
const kickMat = mat('#24123f', { roughness: 0.5 });

function buildLane(scene: THREE.Scene, ox: number, withDecorPins: boolean) {
  const g = new THREE.Group();
  g.position.x = ox;
  scene.add(g);

  // Approach
  const approach = new THREE.Mesh(new THREE.PlaneGeometry(LANE_SPACING, LANE.approachLength), approachMat);
  approach.rotation.x = -Math.PI / 2;
  approach.position.set(0, 0, LANE.approachLength / 2);
  approach.receiveShadow = true;
  g.add(approach);

  // Lane bed
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE.width, LANE.length - 1.0), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, -(LANE.length - 1.0) / 2);
  lane.receiveShadow = true;
  g.add(lane);

  const deck = new THREE.Mesh(new THREE.PlaneGeometry(LANE.width, 1.0), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, 0, -LANE.length + 0.5);
  deck.receiveShadow = true;
  g.add(deck);

  // Gutters: half pipes on each side
  const r = LANE.gutterWidth / 2;
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, LANE.length, 20, 1, true, -Math.PI / 2, Math.PI), gutterMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * (LANE.halfWidth + r), 0, -LANE.length / 2);
    pipe.receiveShadow = true;
    g.add(pipe);
  }

  // Foul line + sensor posts
  const foul = new THREE.Mesh(new THREE.PlaneGeometry(LANE.width + LANE.gutterWidth * 2, 0.02), mat('#d11', { emissive: '#600' }));
  foul.rotation.x = -Math.PI / 2;
  foul.position.set(0, 0.001, 0);
  g.add(foul);
  for (const side of [-1, 1]) {
    g.add(box(0.05, 0.12, 0.05, mat('#222', { metalness: 0.6 }), side * (LANE.halfWidth + LANE.gutterWidth + 0.04), 0.06, 0));
  }

  // Targeting arrows (12–16 ft, chevron) and dots
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.09);
  arrowShape.lineTo(-0.018, -0.07);
  arrowShape.lineTo(0.018, -0.07);
  arrowShape.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrowShape);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrows = new THREE.InstancedMesh(arrowGeo, markMat, 7);
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < 7; k++) {
    const depth = (12 + (3 - Math.abs(k - 3)) * (4 / 3)) * FT;
    m4.makeTranslation(boardX(5 + k * 5), 0.0015, -depth);
    arrows.setMatrixAt(k, m4);
  }
  g.add(arrows);

  const dotBoards = [3, 5, 8, 11, 14, 26, 29, 32, 35, 37];
  const dotRows = [-7 * FT, 2 * FT, 12 * FT, 15 * FT];
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.011, 12).rotateX(-Math.PI / 2), markMat, dotBoards.length * dotRows.length + 3);
  let di = 0;
  for (const z of dotRows) {
    for (const b of dotBoards) {
      m4.makeTranslation(boardX(b), 0.0015, z);
      dots.setMatrixAt(di++, m4);
    }
  }
  for (const z of [2 * FT, 12 * FT, 15 * FT]) {
    m4.makeTranslation(boardX(20), 0.0015, z);
    dots.setMatrixAt(di++, m4);
  }
  g.add(dots);

  // Pin spots on the deck
  const spots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.028, 16).rotateX(-Math.PI / 2), mat('#5a2d10'), 10);
  PIN_SPOTS.forEach((s, i) => {
    m4.makeTranslation(s.x, 0.0012, s.z);
    spots.setMatrixAt(i, m4);
  });
  g.add(spots);

  // Pit and kickbacks
  const pitZ = -LANE.length - LANE.pitLength / 2;
  g.add(box(LANE.width + LANE.gutterWidth * 2, 0.05, LANE.pitLength, pitMat, 0, -LANE.pitDepth, pitZ));
  g.add(box(LANE_SPACING, 1.6, 0.1, pitMat, 0, 0.3, -LANE.length - LANE.pitLength));
  for (const side of [-1, 1]) {
    const kz0 = -16.9;
    const kz1 = -LANE.length - LANE.pitLength;
    g.add(box(0.1, 0.75, kz0 - kz1, kickMat, side * (LANE.halfWidth + LANE.gutterWidth + 0.05), 0.3, (kz0 + kz1) / 2));
  }

  if (withDecorPins) {
    for (const s of PIN_SPOTS) {
      const p = createPinMesh();
      p.position.set(s.x, 0, s.z);
      g.add(p);
    }
  }
}

function buildLanePhysics(world: CANNON.World) {
  const { lane, wall } = materials;
  const L = LANE.length;
  const hw = LANE.halfWidth;
  const gw = LANE.gutterWidth;
  // Approach (wider than the lane so a released ball never drops off it)
  staticBox(world, lane, LANE_SPACING / 2, 0.1, LANE.approachLength / 2, 0, -0.1, LANE.approachLength / 2);
  // Lane + pin deck
  staticBox(world, lane, hw, 0.1, L / 2, 0, -0.1, -L / 2);
  for (const side of [-1, 1]) {
    // Gutter floor and outer wall
    staticBox(world, lane, gw / 2, 0.1, L / 2, side * (hw + gw / 2), -0.1 - LANE.gutterDepth, -L / 2);
    staticBox(world, wall, 0.04, 0.1, L / 2, side * (hw + gw + 0.04), -0.05, -L / 2);
    // Kickbacks
    staticBox(world, wall, 0.05, 0.45, 2.1, side * (hw + gw + 0.05), 0.3, -19.0);
  }
  // Pit floor and back cushion
  staticBox(world, wall, 1.0, 0.1, LANE.pitLength / 2, 0, -LANE.pitDepth - 0.1, -L - LANE.pitLength / 2);
  staticBox(world, wall, 1.0, 0.8, 0.1, 0, 0, -L - LANE.pitLength - 0.05);
}

function buildRack(scene: THREE.Scene): { slots: THREE.Vector3[]; obstacle: Obstacle } {
  const cx = -2.3;
  const cz = 6.4;
  const len = 1.35;
  const metal = mat('#b8c0cc', { metalness: 0.85, roughness: 0.25 });
  const accent = mat('#ff3d9a', { emissive: '#7a0d45', roughness: 0.4 });
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  scene.add(g);

  const tube = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rad = 0.018, m: THREE.Material = metal) => {
    const a = new THREE.Vector3(x0, y0, z0);
    const b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 10), m);
    t.position.copy(a).lerp(b, 0.5);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    t.castShadow = true;
    g.add(t);
  };

  const tiers = [
    { y: 0.42, z: -0.12 },
    { y: 0.78, z: 0.14 },
  ];
  // Rails: each tier has two rails the balls sit between.
  for (const t of tiers) {
    for (const dz of [-0.07, 0.07]) tube(-len / 2, t.y, t.z + dz, len / 2, t.y, t.z + dz);
  }
  // Legs / end frames
  for (const ex of [-len / 2, len / 2]) {
    tube(ex, 0, -0.2, ex, 0.42, -0.2, 0.025);
    tube(ex, 0, 0.22, ex, 0.78, 0.22, 0.025);
    tube(ex, 0.42, -0.2, ex, 0.78, 0.22, 0.025);
    tube(ex, 0.42, -0.2, ex, 0.42, 0.22, 0.02);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.5), accent);
    foot.position.set(ex, 0.015, 0.01);
    g.add(foot);
  }
  // Header sign
  const sign = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.03), accent);
  sign.position.set(0, 1.02, 0.22);
  g.add(sign);
  tube(-len / 2, 0.78, 0.22, -len / 2, 1.02, 0.22, 0.02);
  tube(len / 2, 0.78, 0.22, len / 2, 1.02, 0.22, 0.02);

  const slots: THREE.Vector3[] = [];
  for (const t of tiers) {
    for (let i = 0; i < 4; i++) {
      const x = -len / 2 + (len / 4) * (i + 0.5);
      slots.push(new THREE.Vector3(cx + x, t.y + 0.075, cz + t.z));
    }
  }
  return {
    slots,
    obstacle: { minX: cx - len / 2 - 0.05, maxX: cx + len / 2 + 0.05, minZ: cz - 0.25, maxZ: cz + 0.27 },
  };
}

function buildFurniture(scene: THREE.Scene): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const seat = mat('#e11d74', { roughness: 0.45 });
  const seat2 = mat('#0891b2', { roughness: 0.45 });
  const base = mat('#1e1b2e', { metalness: 0.4, roughness: 0.4 });

  // Curved bench behind each pair of lanes
  const bench = (x: number, z: number, m: THREE.Material) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const seatMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 32, 1, false, Math.PI * 0.65, Math.PI * 0.7), m);
    seatMesh.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.5, 32, 1, true, Math.PI * 0.65, Math.PI * 0.7), m);
    (back.material as THREE.Material).side = THREE.DoubleSide;
    back.position.y = 0.75;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.4, 32, 1, false, Math.PI * 0.65, Math.PI * 0.7), base);
    ped.position.y = 0.2;
    for (const m of [seatMesh, back, ped]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    scene.add(g);
    obstacles.push({ minX: x - 1.0, maxX: x + 1.0, minZ: z + 0.35, maxZ: z + 1.2 });
  };
  bench(2.2, 7.6, seat);
  bench(-2.2, 8.9, seat2);

  // Round table with neon edge
  const table = new THREE.Group();
  table.position.set(2.2, 0, 7.0);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 32), mat('#f5f5f5', { roughness: 0.2 }));
  top.position.y = 0.75;
  const edge = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.012, 8, 48), mat('#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 1.5 }));
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.75;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.2, 0.75, 16), base);
  leg.position.y = 0.375;
  table.add(top, edge, leg);
  table.traverse((o) => (o.castShadow = true));
  scene.add(table);
  obstacles.push({ minX: 1.8, maxX: 2.6, minZ: 6.6, maxZ: 7.4 });
  return obstacles;
}

export function buildHall(scene: THREE.Scene, world: CANNON.World): Hall {
  scene.background = new THREE.Color('#0b0620');
  scene.fog = new THREE.Fog('#0b0620', 28, 48);

  buildLane(scene, 0, false);
  for (const i of DECOR_LANES) buildLane(scene, i * LANE_SPACING, true);
  buildLanePhysics(world);

  // Cappings between lanes
  const lanes = [...DECOR_LANES, 0].sort((a, b) => a - b);
  const capW = LANE_SPACING - LANE.width - LANE.gutterWidth * 2;
  for (let i = 0; i <= lanes.length; i++) {
    const x = (lanes[0] - 0.5 + i) * LANE_SPACING;
    scene.add(box(capW, 0.06, LANE.length, capMat, x, 0.0, -LANE.length / 2));
  }

  // Concourse carpet and side floor
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(HALL.maxX - HALL.minX, HALL.backZ - LANE.approachLength), mat('#ffffff', { map: carpetTexture(), roughness: 0.95 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0, (HALL.backZ + LANE.approachLength) / 2);
  carpet.receiveShadow = true;
  scene.add(carpet);
  const step = box(HALL.maxX - HALL.minX, 0.04, 0.12, mat('#facc15', { emissive: '#8a6a00', roughness: 0.4 }), 0, 0.0, LANE.approachLength);
  scene.add(step);

  // Walls, ceiling
  const wallMat = mat('#1a0f33', { roughness: 0.85 });
  const zFront = -LANE.length - LANE.pitLength - 0.5;
  const depth = HALL.backZ - zFront;
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(depth, HALL.ceiling), wallMat);
    w.position.set(side * HALL.maxX, HALL.ceiling / 2, (HALL.backZ + zFront) / 2);
    w.rotation.y = -side * Math.PI / 2;
    w.receiveShadow = true;
    scene.add(w);
    for (const [y, c] of [[2.4, '#ff3d9a'], [2.55, '#22d3ee']] as const) {
      const strip = box(0.03, 0.035, depth, mat(c, { emissive: c, emissiveIntensity: 2 }), side * (HALL.maxX - 0.02), y, (HALL.backZ + zFront) / 2);
      strip.castShadow = false;
      scene.add(strip);
    }
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(HALL.maxX - HALL.minX, HALL.ceiling), wallMat);
  back.position.set(0, HALL.ceiling / 2, HALL.backZ);
  back.rotation.y = Math.PI;
  scene.add(back);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HALL.maxX - HALL.minX, depth), mat('#0d0820'));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, HALL.ceiling, (HALL.backZ + zFront) / 2);
  scene.add(ceiling);

  // Ceiling light panels along each lane
  const panelMat = mat('#ffffff', { emissive: '#fff4e0', emissiveIntensity: 1.6 });
  for (const li of lanes) {
    for (let z = 3; z > -16; z -= 4.5) {
      const p = box(0.5, 0.03, 1.4, panelMat, li * LANE_SPACING, HALL.ceiling - 0.02, z);
      p.castShadow = false;
      scene.add(p);
    }
  }

  // Masking unit with neon sign and lane numbers
  const maskZ = -17.2;
  const mask = box(HALL.maxX - HALL.minX, HALL.ceiling - 1.25, 0.4, mat('#0b0620'), 0, (HALL.ceiling + 1.25) / 2, maskZ - 0.2);
  scene.add(mask);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: maskingTexture(), toneMapped: false }));
  sign.position.set(0, 2.85, maskZ + 0.01);
  scene.add(sign);
  lanes.forEach((li, idx) => {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: laneNumberTexture(idx + 1), toneMapped: false }));
    n.position.set(li * LANE_SPACING, 1.6, maskZ + 0.012);
    scene.add(n);
  });
  // Under-masking light strip
  const strip = box(HALL.maxX - HALL.minX, 0.05, 0.12, mat('#fff', { emissive: '#ffffff', emissiveIntensity: 3 }), 0, 1.24, maskZ + 0.05);
  strip.castShadow = false;
  scene.add(strip);

  // Lights
  scene.add(new THREE.HemisphereLight('#c9ccff', '#2a1c40', 1.1));
  const pinSpot = new THREE.SpotLight('#fff3e0', 60, 6, 0.75, 0.5, 1.5);
  pinSpot.position.set(0, 1.25, -17.15);
  pinSpot.target.position.set(0, 0, -18.7);
  pinSpot.castShadow = true;
  pinSpot.shadow.mapSize.set(1024, 1024);
  pinSpot.shadow.bias = -0.0005;
  scene.add(pinSpot, pinSpot.target);
  for (const li of DECOR_LANES) {
    const p = new THREE.PointLight('#fff3e0', 6, 3.5, 1.5);
    p.position.set(li * LANE_SPACING, 1.1, -17.6);
    scene.add(p);
  }
  for (const [x, z, c] of [[-3, 8, '#ff3d9a'], [3, 9, '#22d3ee'], [0, 5, '#fff3e0']] as const) {
    const p = new THREE.PointLight(c, 8, 9, 1.6);
    p.position.set(x, 3.2, z);
    scene.add(p);
  }

  const rack = buildRack(scene);
  const obstacles = [rack.obstacle, ...buildFurniture(scene)];
  return { rackSlots: rack.slots, obstacles };
}
