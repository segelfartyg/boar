import * as THREE from 'three';

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  drag: number;
  /** Confetti flutters: strong drag + sideways wobble. */
  flutter: boolean;
  color: string;
}

const MAX_PARTICLES = 1400;
const CONFETTI_COLORS = ['#ff3d9a', '#22d3ee', '#facc15', '#a3e635', '#a78bfa', '#ffffff', '#fb923c'];

/**
 * One-shot visual effects: particles (confetti, sparks, cheese crumbs, dust),
 * bullet tracers and muzzle flashes.
 */
export class Effects {
  private particles: Particle[] = [];
  private mesh: THREE.InstancedMesh;
  private tracers: { line: THREE.Line; life: number }[] = [];
  private flash: THREE.PointLight;
  private flashSprite: THREE.Mesh;
  private flashLife = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
      MAX_PARTICLES,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    // Ensure the instanceColor buffer exists.
    this.mesh.setColorAt(0, this.color.set('#fff'));
    scene.add(this.mesh);

    this.flash = new THREE.PointLight('#ffb347', 0, 6, 2);
    scene.add(this.flash);
    this.flashSprite = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, toneMapped: false }),
    );
    this.flashSprite.visible = false;
    scene.add(this.flashSprite);
  }

  private spawn(p: Omit<Particle, 'maxLife' | 'rot' | 'spin'>) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    const particle: Particle = {
      ...p,
      maxLife: p.life,
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18),
    };
    this.particles.push(particle);
  }

  /** Cone of confetti from `origin` along `dir`. */
  confetti(origin: THREE.Vector3, dir: THREE.Vector3, count = 260, spread = 0.45, speed = 9) {
    for (let i = 0; i < count; i++) {
      const v = dir.clone().normalize();
      v.x += (Math.random() * 2 - 1) * spread;
      v.y += (Math.random() * 2 - 1) * spread * 0.8 + 0.1;
      v.z += (Math.random() * 2 - 1) * spread;
      v.normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.spawn({
        pos: origin.clone(),
        vel: v,
        life: 2.5 + Math.random() * 2,
        size: 0.025 + Math.random() * 0.02,
        gravity: 3,
        drag: 2.6,
        flutter: true,
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      });
    }
  }

  /** Little bursts: impacts, cheese splats, dust. */
  burst(origin: THREE.Vector3, color: string, count: number, speed: number, size = 0.02, life = 0.5, gravity = 9) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.4 - 0.2, Math.random() * 2 - 1).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.spawn({ pos: origin.clone(), vel: v, life: life * (0.6 + Math.random() * 0.8), size, gravity, drag: 1, flutter: false, color });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.9, toneMapped: false }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  muzzleFlash(at: THREE.Vector3, scale = 1, color = '#ffb347') {
    this.flash.position.copy(at);
    this.flash.color.set(color);
    this.flash.intensity = 6 * scale;
    this.flashSprite.position.copy(at);
    this.flashSprite.scale.setScalar(scale * (0.8 + Math.random() * 0.6));
    this.flashSprite.visible = true;
    this.flashLife = 0.05;
  }

  update(dt: number) {
    // Particles
    let n = 0;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.pos.y <= 0.002 && p.vel.y <= 0) {
        // Resting on the floor.
        p.pos.y = 0.002;
        p.vel.set(0, 0, 0);
        p.spin.set(0, 0, 0);
        p.rot.x = -Math.PI / 2;
      } else {
        p.vel.y -= p.gravity * dt;
        p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        if (p.flutter) p.pos.x += Math.sin(p.life * 9 + p.size * 400) * 0.25 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
      }
      alive.push(p);
      const fade = Math.min(1, p.life / Math.min(0.4, p.maxLife));
      this.q.setFromEuler(p.rot);
      this.s.set(p.size * fade, p.size * 0.65 * fade, 1);
      this.m4.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m4);
      this.mesh.setColorAt(n, this.color.set(p.color));
      n++;
    }
    this.particles = alive;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // Tracers
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.07);
      if (t.life > 0) return true;
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
      return false;
    });

    // Muzzle flash
    this.flashLife -= dt;
    if (this.flashLife <= 0) {
      this.flash.intensity = 0;
      this.flashSprite.visible = false;
    }
  }
}
