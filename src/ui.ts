import type { Actor } from './actors/actor';
import { Scorecard } from './scoring';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Pin diagram layout as seen from the bowler: back row on top.
const DIAGRAM_ROWS = [
  [7, 8, 9, 10],
  [4, 5, 6],
  [2, 3],
  [1],
];

export class UI {
  private scoreboard = $('scoreboard');
  private pinDiagram = $('pin-diagram');
  private prompt = $('prompt');
  private message = $('message');
  private power = $('power-meter');
  private powerFill = $('power-fill');
  private powerValue = $('power-value');
  private spin = $('spin-meter');
  private spinNeedle = $('spin-needle');
  private spinValue = $('spin-value');
  private throwInfo = $('throw-info');
  private gameOver = $('game-over');
  private help = $('help');
  private roster = $('roster');
  private feedEl = $('feed');
  private composure = $('composure');
  private composureFill = $('composure-fill');
  private crosshair = $('crosshair');
  private weaponHud = $('weapon-hud');
  private overlay = $('fx-overlay');
  private rosterKey = '';
  private pinEls = new Map<number, HTMLElement>();
  private messageTimer = 0;

  constructor() {
    for (const row of DIAGRAM_ROWS) {
      const r = document.createElement('div');
      r.className = 'pin-row';
      for (const n of row) {
        const p = document.createElement('div');
        p.className = 'pin up';
        p.textContent = String(n);
        r.appendChild(p);
        this.pinEls.set(n, p);
      }
      this.pinDiagram.appendChild(r);
    }
  }

  toggleHelp() {
    this.help.classList.toggle('hidden');
  }

  renderScoreboard(card: Scorecard, active: boolean) {
    const cumulative = card.cumulative();
    const current = card.isComplete ? -1 : card.frameIndex;
    let html = '<div class="frames">';
    for (let f = 0; f < 10; f++) {
      const marks = card.marks(f);
      const cls = ['frame', f === 9 ? 'tenth' : '', f === current && active ? 'current' : ''].join(' ');
      html += `<div class="${cls}"><div class="frame-no">${f + 1}</div><div class="boxes">`;
      for (const m of marks) {
        const markCls = m.text === 'X' ? 'strike' : m.text === '/' ? 'spare' : m.text === 'F' ? 'foul' : '';
        html += `<div class="box ${markCls}"><span class="${m.split ? 'split' : ''}">${m.text}</span></div>`;
      }
      const c = cumulative[f];
      html += `</div><div class="cum">${c ?? ''}</div></div>`;
    }
    html += `<div class="frame total"><div class="frame-no">TOTAL</div><div class="cum big">${card.currentTotal()}</div></div></div>`;
    this.scoreboard.innerHTML = html;
  }

  renderPins(standing: Set<number>) {
    for (const [n, el] of this.pinEls) el.className = 'pin ' + (standing.has(n) ? 'up' : 'down');
  }

  setPrompt(html: string) {
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    this.prompt.classList.toggle('hidden', html === '');
  }

  showMessage(title: string, sub = '', kind = '') {
    this.message.innerHTML = `<div class="title ${kind}">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    this.message.classList.remove('show');
    void this.message.offsetWidth;
    this.message.classList.add('show');
    clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => this.message.classList.remove('show'), 2600);
  }

  showPower(on: boolean) {
    this.power.classList.toggle('hidden', !on);
  }

  setPower(v: number, locked = false) {
    this.powerFill.style.height = `${v * 100}%`;
    this.powerValue.textContent = `${Math.round(v * 100)}%`;
    this.power.classList.toggle('locked', locked);
    this.power.classList.toggle('over', v > 0.9);
  }

  showSpin(on: boolean) {
    this.spin.classList.toggle('hidden', !on);
  }

  setSpin(v: number, locked = false) {
    this.spinNeedle.style.left = `${50 + v * 50}%`;
    const dir = Math.abs(v) < 0.08 ? 'straight' : v < 0 ? '← left' : 'right →';
    this.spinValue.textContent = `${Math.abs(v).toFixed(2)} ${dir}`;
    this.spin.classList.toggle('locked', locked);
  }

  setThrowInfo(html: string) {
    this.throwInfo.innerHTML = html;
    this.throwInfo.classList.toggle('hidden', html === '');
  }

  showGameOver(score: number | null) {
    this.gameOver.classList.toggle('hidden', score === null);
    if (score !== null) $('final-score').textContent = String(score);
  }

  /** Everyone in the hall, with role, health and weapon. */
  renderRoster(actors: Actor[]) {
    const rows = actors.map((a) => {
      const f = Math.max(0, a.hp / a.maxHp);
      const bar = a.role === 'bowler' ? 'composure' : 'hp';
      return (
        `<div class="row ${a.role}${a.knockedOut ? ' ko' : ''}"><span class="name">${a.name}</span>` +
        `<span class="badge">${a.role === 'bowler' ? 'BOWLER' : a.knockedOut ? 'KO' : 'SABOTEUR'}</span>` +
        `<span class="weapon">${a.weapon ? a.weapon.spec.name : a.carryingBall ? '🎳' : ''}</span>` +
        `<span class="bar ${bar}"><i style="width:${(f * 100).toFixed(0)}%"></i></span></div>`
      );
    });
    const html = rows.join('');
    if (html === this.rosterKey) return;
    this.rosterKey = html;
    this.roster.innerHTML = html ? `<div class="title">IN THE HALL</div>${html}` : '';
  }

  /** A line in the event feed (hits, pickups, knock-outs). */
  feed(html: string) {
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML = html;
    this.feedEl.prepend(line);
    while (this.feedEl.children.length > 6) this.feedEl.lastChild!.remove();
    window.setTimeout(() => line.classList.add('fade'), 4000);
    window.setTimeout(() => line.remove(), 5000);
  }

  setComposure(v: number, shaking: boolean) {
    this.composureFill.style.width = `${Math.max(0, v) * 100}%`;
    this.composure.classList.toggle('low', v < 0.35);
    this.composure.classList.toggle('shaking', shaking);
  }

  showCrosshair(on: boolean) {
    this.crosshair.classList.toggle('hidden', !on);
  }

  setWeaponHud(html: string) {
    if (this.weaponHud.innerHTML !== html) this.weaponHud.innerHTML = html;
    this.weaponHud.classList.toggle('hidden', html === '');
  }

  /** Full-screen hit effects for the local player. */
  screenFx(kind: 'cheese' | 'confetti' | 'hit', strength = 1) {
    if (kind === 'hit') {
      const v = document.createElement('div');
      v.className = 'fx-hit';
      v.style.opacity = String(Math.min(1, 0.4 + strength * 0.6));
      this.overlay.appendChild(v);
      window.setTimeout(() => v.remove(), 700);
      return;
    }
    if (kind === 'cheese') {
      for (let i = 0; i < 5; i++) {
        const b = document.createElement('div');
        b.className = 'fx-cheese';
        const size = 160 + Math.random() * 260;
        b.style.width = b.style.height = `${size}px`;
        b.style.left = `${10 + Math.random() * 70}%`;
        b.style.top = `${10 + Math.random() * 60}%`;
        b.style.transform = `translate(-50%,-50%) rotate(${Math.random() * 360}deg) scale(${0.8 + Math.random() * 0.5})`;
        this.overlay.appendChild(b);
        window.setTimeout(() => b.remove(), 4600);
      }
      return;
    }
    const colors = ['#ff3d9a', '#22d3ee', '#facc15', '#a3e635', '#a78bfa', '#ffffff'];
    for (let i = 0; i < 140; i++) {
      const c = document.createElement('div');
      c.className = 'fx-confetti';
      c.style.left = `${Math.random() * 100}%`;
      c.style.top = `${-10 + Math.random() * 60}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = `${2 + Math.random() * 2.5}s`;
      c.style.animationDelay = `${Math.random() * 0.3}s`;
      c.style.setProperty('--spin', `${(Math.random() * 2 - 1) * 720}deg`);
      c.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 120}px`);
      this.overlay.appendChild(c);
      window.setTimeout(() => c.remove(), 5000);
    }
  }
}
