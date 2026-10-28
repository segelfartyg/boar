import * as THREE from 'three';
import type { WeaponId } from './specs';

const std = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });

const metal = std('#2a2c30', { metalness: 0.8, roughness: 0.35 });
const wood = std('#8a4a22', { roughness: 0.5 });

function part(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

/**
 * Weapon models point their business end along -Z (forward) and are
 * centred on the grip, so they can be mounted on a chest or in a hand.
 */
export function createWeaponModel(id: WeaponId): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'ak47': {
      g.add(
        part(new THREE.BoxGeometry(0.06, 0.08, 0.36), metal, 0, 0.02, -0.08), // receiver
        part(new THREE.BoxGeometry(0.05, 0.06, 0.26), wood, 0, 0.0, 0.25, 0.12), // stock
        part(new THREE.BoxGeometry(0.055, 0.05, 0.2), wood, 0, 0.005, -0.34), // handguard
        part(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 10), metal, 0, 0.03, -0.55, Math.PI / 2), // barrel
        part(new THREE.CylinderGeometry(0.009, 0.009, 0.26, 8), metal, 0, 0.06, -0.38, Math.PI / 2), // gas tube
        part(new THREE.BoxGeometry(0.01, 0.04, 0.012), metal, 0, 0.065, -0.7), // front sight
        part(new THREE.BoxGeometry(0.04, 0.09, 0.04), wood, 0, -0.06, 0.05, -0.35), // grip
      );
      // Curved magazine
      for (let i = 0; i < 4; i++) {
        g.add(part(new THREE.BoxGeometry(0.035, 0.05, 0.065), metal, 0, -0.05 - i * 0.042, -0.14 - i * i * 0.008, -0.25 - i * 0.12));
      }
      break;
    }
    case 'bat': {
      const pts = [
        [0.0, -0.08], [0.018, -0.08], [0.02, -0.07], [0.014, -0.06], [0.015, 0.1], [0.02, 0.3], [0.03, 0.48],
        [0.035, 0.62], [0.034, 0.7], [0.026, 0.72], [0.0, 0.72],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const bat = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), std('#d9b17a', { roughness: 0.35 }));
      bat.castShadow = true;
      const tape = part(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 12), std('#151515', { roughness: 0.9 }), 0, 0.02, 0);
      const nail = part(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 6), std('#999', { metalness: 1, roughness: 0.3 }), 0.03, 0.6, 0, 0, 0, Math.PI / 2);
      const nail2 = nail.clone();
      nail2.position.set(0, 0.55, 0.03);
      nail2.rotation.set(Math.PI / 2, 0, 0);
      g.add(bat, tape, nail, nail2);
      // Bat runs along -Y from the hand (continuing the forearm).
      g.rotation.x = Math.PI;
      break;
    }
    case 'cheese': {
      g.add(createCheeseMesh());
      break;
    }
    case 'confetti': {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 20, 1, true), new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.4, side: THREE.DoubleSide }));
      tube.rotation.x = Math.PI / 2;
      tube.position.z = -0.18;
      tube.castShadow = true;
      const bell = part(new THREE.CylinderGeometry(0.1, 0.06, 0.1, 20, 1, true), std('#facc15', { side: THREE.DoubleSide, metalness: 0.3 }), 0, 0, -0.47, Math.PI / 2);
      const cap = part(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20), std('#ff3d9a'), 0, 0, 0.08, Math.PI / 2);
      const grip = part(new THREE.BoxGeometry(0.035, 0.1, 0.04), std('#111'), 0, -0.08, 0.0, -0.3);
      const pullRing = part(new THREE.TorusGeometry(0.025, 0.006, 6, 14), std('#ddd', { metalness: 0.8 }), 0, 0, 0.12);
      // A little fuse of streamers poking out the end.
      for (let i = 0; i < 6; i++) {
        const c = ['#22d3ee', '#ff3d9a', '#facc15', '#a3e635'][i % 4];
        g.add(part(new THREE.BoxGeometry(0.008, 0.002, 0.07), std(c), Math.cos(i) * 0.04, Math.sin(i) * 0.04, -0.5, 0.4 * Math.sin(i * 2), 0.4 * Math.cos(i)));
      }
      g.add(tube, bell, cap, grip, pullRing);
      break;
    }
  }
  return g;
}

let cheeseGeo: THREE.ExtrudeGeometry | null = null;
let cheeseMat: THREE.MeshStandardMaterial | null = null;

/** A wedge of Swiss cheese, roughly 18 × 9 × 14 cm, centred on its middle. */
export function createCheeseMesh(): THREE.Mesh {
  if (!cheeseGeo) {
    const s = new THREE.Shape();
    s.moveTo(-0.09, -0.07);
    s.lineTo(0.09, -0.07);
    s.lineTo(-0.09, 0.07);
    s.closePath();
    for (const [x, y, r] of [[-0.05, -0.03, 0.015], [0.02, -0.045, 0.012], [-0.065, 0.03, 0.01]]) {
      const hole = new THREE.Path();
      hole.absarc(x, y, r, 0, Math.PI * 2, true);
      s.holes.push(hole);
    }
    cheeseGeo = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
    cheeseGeo.translate(0, 0, -0.045);
    cheeseGeo.rotateX(-Math.PI / 2);
    cheeseMat = std('#ffc933', { roughness: 0.45, emissive: '#3a2a00' });
  }
  const m = new THREE.Mesh(cheeseGeo, cheeseMat!);
  m.castShadow = true;
  return m;
}

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  const colors = ['#ff3d9a', '#ffffff', '#22d3ee', '#ffffff'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = colors[i % 4];
    g.fillRect(i * 16, 0, 16, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}
