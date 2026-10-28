export type RackAction = 'reset' | 'sweep' | 'gameover';

export interface Roll {
  pins: number;
  foul: boolean;
  split: boolean;
}

/**
 * Standard ten-pin scoring for a single player, including the
 * tenth-frame bonus balls.
 */
export class Scorecard {
  frames: Roll[][] = [[]];

  get frameIndex(): number {
    return this.frames.length - 1;
  }

  get ballInFrame(): number {
    return this.frames[this.frameIndex].length;
  }

  get isComplete(): boolean {
    const f = this.frames;
    if (f.length < 10) return false;
    const r = f[9].map((x) => x.pins);
    if (r.length === 3) return true;
    return r.length === 2 && r[0] + r[1] < 10;
  }

  /** True when the next ball is thrown at a full rack. */
  get freshRack(): boolean {
    const r = this.frames[this.frameIndex].map((x) => x.pins);
    if (r.length === 0) return true;
    if (this.frameIndex < 9) return false;
    if (r.length === 1) return r[0] === 10;
    return (r[0] === 10 && r[1] === 10) || (r[0] !== 10 && r[0] + r[1] === 10);
  }

  reset() {
    this.frames = [[]];
  }

  /** Records a roll and returns what the pinsetter should do next. */
  addRoll(roll: Roll): RackAction {
    const fi = this.frameIndex;
    const frame = this.frames[fi];
    frame.push(roll);
    const r = frame.map((x) => x.pins);

    if (fi < 9) {
      if ((r.length === 1 && r[0] === 10) || r.length === 2) {
        this.frames.push([]);
        return 'reset';
      }
      return 'sweep';
    }

    if (r.length === 1) return r[0] === 10 ? 'reset' : 'sweep';
    if (r.length === 2) {
      if (r[0] === 10) return r[1] === 10 ? 'reset' : 'sweep';
      return r[0] + r[1] === 10 ? 'reset' : 'gameover';
    }
    return 'gameover';
  }

  /** Cumulative score per frame, or null where it cannot be known yet. */
  cumulative(): (number | null)[] {
    const rolls = this.frames.flat().map((r) => r.pins);
    const out: (number | null)[] = [];
    let total = 0;
    let i = 0;
    for (let f = 0; f < 10; f++) {
      if (i >= rolls.length) {
        out.push(null);
        continue;
      }
      let frameScore: number | null;
      if (rolls[i] === 10) {
        frameScore = i + 2 < rolls.length ? 10 + rolls[i + 1] + rolls[i + 2] : null;
        i += 1;
      } else if (i + 1 < rolls.length && rolls[i] + rolls[i + 1] === 10) {
        frameScore = i + 2 < rolls.length ? 10 + rolls[i + 2] : null;
        i += 2;
      } else if (i + 1 < rolls.length) {
        frameScore = rolls[i] + rolls[i + 1];
        i += 2;
      } else {
        frameScore = null;
        i += 1;
      }
      if (frameScore === null) {
        // Everything after an unresolved frame is unresolved too.
        for (; f < 10; f++) out.push(null);
        break;
      }
      total += frameScore;
      out.push(total);
    }
    return out;
  }

  /** Running total of everything knocked down so far plus resolved bonuses. */
  currentTotal(): number {
    const c = this.cumulative().filter((x): x is number => x !== null);
    return c.length ? c[c.length - 1] : 0;
  }

  /** Symbols for each box of a frame (2 boxes, or 3 in the tenth). */
  marks(fi: number): { text: string; split: boolean }[] {
    const frame = this.frames[fi] ?? [];
    const boxes = fi < 9 ? 2 : 3;
    const out: { text: string; split: boolean }[] = [];
    const num = (roll: Roll) => (roll.foul ? 'F' : roll.pins === 0 ? '-' : String(roll.pins));

    if (fi < 9) {
      const [a, b] = frame;
      if (a && a.pins === 10) {
        out.push({ text: '', split: false }, { text: 'X', split: false });
        return out;
      }
      out.push(a ? { text: num(a), split: a.split } : { text: '', split: false });
      out.push(b ? { text: a.pins + b.pins === 10 ? '/' : num(b), split: false } : { text: '', split: false });
      return out;
    }

    // Tenth frame: a box shows X or / depending on what it was thrown at.
    let rackStanding = 10;
    for (let k = 0; k < boxes; k++) {
      const roll = frame[k];
      if (!roll) {
        out.push({ text: '', split: false });
        continue;
      }
      let text: string;
      if (rackStanding === 10 && roll.pins === 10) text = 'X';
      else if (rackStanding < 10 && roll.pins === rackStanding) text = '/';
      else text = num(roll);
      out.push({ text, split: roll.split });
      rackStanding -= roll.pins;
      if (rackStanding === 0) rackStanding = 10;
    }
    return out;
  }
}
