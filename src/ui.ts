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
}
