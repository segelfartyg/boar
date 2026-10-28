import * as THREE from 'three';
import { LANE } from './constants';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, repeatY);
  t.anisotropy = 8;
  return t;
}

/** Maple/pine lane boards running along the lane. */
export function laneWoodTexture(repeatY: number, tint = 0): THREE.CanvasTexture {
  const boards = LANE.boards;
  const bw = 16;
  const [c, g] = canvas(boards * bw, 512);
  for (let i = 0; i < boards; i++) {
    const l = 62 + Math.sin(i * 12.9898) * 4 + tint;
    g.fillStyle = `hsl(32, 48%, ${l}%)`;
    g.fillRect(i * bw, 0, bw, 512);
    // grain
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `hsla(28, 40%, ${l - 12}%, ${0.08 + Math.random() * 0.1})`;
      g.lineWidth = 1;
      g.beginPath();
      const x = i * bw + Math.random() * bw;
      g.moveTo(x, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.02 + k) * 1.5, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(60,35,15,0.35)';
    g.fillRect(i * bw, 0, 1, 512);
  }
  return toTexture(c, repeatY);
}

/** Marbled reactive-ball coverstock with three finger holes. */
export function ballTexture(base: string, swirl: string, highlight: string): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const a = new THREE.Color(base);
  const b = new THREE.Color(swirl);
  const d = new THREE.Color(highlight);
  const seed = Math.random() * 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x / w) * Math.PI * 2;
      const v = (y / h) * Math.PI;
      let n =
        Math.sin(u * 3 + Math.sin(v * 4 + seed) * 2.2) +
        Math.sin(v * 5 + Math.cos(u * 2 + seed) * 1.7) * 0.8 +
        Math.sin((u + v) * 7 + seed) * 0.25;
      n = n * 0.5 + 0.5;
      const t = THREE.MathUtils.smoothstep(n, 0.35, 0.75);
      const hl = Math.pow(Math.max(0, Math.sin(u * 5 + v * 3 + seed)), 12) * 0.6;
      const i = (y * w + x) * 4;
      img.data[i] = (a.r * (1 - t) + b.r * t + d.r * hl) * 255;
      img.data[i + 1] = (a.g * (1 - t) + b.g * t + d.g * hl) * 255;
      img.data[i + 2] = (a.b * (1 - t) + b.b * t + d.b * hl) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Finger holes, placed near the "front" of the ball.
  const holes: [number, number, number][] = [
    [0.25, 0.33, 9],
    [0.28, 0.33, 9],
    [0.265, 0.45, 11],
  ];
  for (const [u, v, r] of holes) {
    const grd = g.createRadialGradient(u * w, v * h, 1, u * w, v * h, r);
    grd.addColorStop(0, '#000');
    grd.addColorStop(0.75, '#111');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(u * w, v * h, r, r * 0.9, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Retro bowling-alley carpet. */
export function carpetTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#1a1336';
  g.fillRect(0, 0, 512, 512);
  const colors = ['#ff3d9a', '#22d3ee', '#facc15', '#a78bfa'];
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = colors[i % colors.length];
    g.globalAlpha = 0.55;
    g.lineWidth = 3;
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const s = 8 + Math.random() * 18;
    g.beginPath();
    switch (i % 3) {
      case 0:
        g.arc(x, y, s, 0, Math.PI * 2);
        break;
      case 1:
        g.moveTo(x - s, y);
        g.quadraticCurveTo(x, y - s * 1.5, x + s, y);
        g.quadraticCurveTo(x + s * 2, y + s * 1.5, x + s * 3, y);
        break;
      default:
        g.moveTo(x, y - s);
        g.lineTo(x + s, y + s);
        g.lineTo(x - s, y + s);
        g.closePath();
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = toTexture(c);
  t.repeat.set(5, 4);
  return t;
}

/** Neon sign art for the masking unit above the pins. */
export function maskingTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(2048, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#0b0620');
  grd.addColorStop(1, '#1d0b3a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 2048, 512);
  // starbursts
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = i % 2 ? '#22d3ee' : '#ff3d9a';
    g.globalAlpha = 0.4;
    g.lineWidth = 2;
    const x = Math.random() * 2048;
    const y = 40 + Math.random() * 430;
    const s = 6 + Math.random() * 14;
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 4;
      g.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s);
      g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  g.font = 'italic 900 190px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff3d9a';
  g.shadowBlur = 40;
  g.fillStyle = '#ffd1ea';
  g.fillText('BOAR LANES', 1024, 230);
  g.shadowColor = '#22d3ee';
  g.shadowBlur = 25;
  g.font = 'bold 60px "Arial", sans-serif';
  g.fillStyle = '#c8f7ff';
  g.fillText('★  STRIKE  ·  SPARE  ·  REPEAT  ★', 1024, 400);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Big lane number for the masking unit. */
export function laneNumberTexture(n: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#0b0620';
  g.fillRect(0, 0, 256, 256);
  g.font = 'bold 180px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#facc15';
  g.shadowBlur = 30;
  g.fillStyle = '#fff3b0';
  g.fillText(String(n), 128, 138);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
