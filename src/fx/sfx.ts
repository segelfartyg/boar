/** Tiny synthesized sound effects (no audio assets needed). */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture before sounds can play. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  /** Volume falloff for a sound at `distance` meters from the listener. */
  private gainFor(distance: number) {
    return 1 / (1 + distance * 0.25);
  }

  private noise(duration: number, filterFreq: number, volume: number, type: BiquadFilterType = 'lowpass', sweepTo?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + duration);
  }

  gunshot(distance = 0) {
    const v = this.gainFor(distance);
    this.noise(0.12, 2400, 0.9 * v, 'lowpass', 300);
    this.tone('square', 160, 40, 0.08, 0.25 * v);
  }

  swing(distance = 0) {
    this.noise(0.25, 600, 0.35 * this.gainFor(distance), 'bandpass', 2200);
  }

  bonk(distance = 0) {
    const v = this.gainFor(distance);
    this.tone('triangle', 420, 90, 0.18, 0.6 * v);
    this.noise(0.08, 1800, 0.5 * v);
  }

  splat(distance = 0) {
    const v = this.gainFor(distance);
    this.noise(0.25, 900, 0.6 * v, 'lowpass', 120);
    this.tone('sine', 240, 60, 0.2, 0.3 * v);
  }

  whoosh(distance = 0) {
    this.noise(0.35, 400, 0.25 * this.gainFor(distance), 'bandpass', 1500);
  }

  pop(distance = 0) {
    const v = this.gainFor(distance);
    this.noise(0.3, 3000, 0.8 * v, 'highpass', 800);
    this.tone('sine', 300, 1400, 0.15, 0.3 * v);
    for (let i = 0; i < 4; i++) this.tone('sine', 900 + Math.random() * 1200, 2000, 0.06, 0.08 * v, 0.05 + i * 0.05);
  }

  grunt(pitch = 1) {
    this.tone('sawtooth', 190 * pitch, 110 * pitch, 0.2, 0.2);
  }

  rumble() {
    this.noise(1.2, 140, 0.8, 'lowpass', 60);
    this.tone('sine', 55, 35, 1.2, 0.4);
  }

  skitter() {
    for (let i = 0; i < 10; i++) this.tone('square', 2400 + Math.random() * 800, 1800, 0.02, 0.05, i * 0.04);
  }

  pickup() {
    this.tone('triangle', 500, 900, 0.08, 0.2);
  }
}

export const sfx = new Sfx();
