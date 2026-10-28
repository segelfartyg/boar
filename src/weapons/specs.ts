import type { ActionKind, HoldPose } from '../characters/humanoid';

export type WeaponId = 'ak47' | 'bat' | 'cheese' | 'confetti';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  hold: HoldPose;
  action: ActionKind;
  /** Where the model attaches: the right hand, or in front of the chest (two-handed). */
  mount: 'hand' | 'chest';
  /** Seconds between uses. */
  cooldown: number;
  /** Keeps firing while `use` is held. */
  automatic: boolean;
  /** Length of the use animation, and the fraction of it at which the effect happens. */
  actionDuration: number;
  hitAt: number;
  damage: number;
  /** 0–1: how badly a hit wrecks a bowler's shot. ≥ 0.9 knocks them out of their stance. */
  disrupt: number;
  /** Camera shake added when the local player is hit. */
  trauma: number;
  knockback: number;
  /** Max effective range (m). */
  range: number;
  /** Distance band an AI tries to keep from its target. */
  preferredRange: [number, number];
  /** Shots per magazine (guns) or 0 for unlimited. */
  magazine: number;
  reload: number;
  /** Used up when used (thrown); the stand restocks it. */
  consumable: boolean;
  blurb: string;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    hold: 'rifle',
    action: 'fire',
    mount: 'chest',
    cooldown: 0.11,
    automatic: true,
    actionDuration: 0.1,
    hitAt: 0,
    damage: 9,
    disrupt: 0.3,
    trauma: 0.28,
    knockback: 0.4,
    range: 40,
    preferredRange: [3.5, 7],
    magazine: 30,
    reload: 2.2,
    consumable: false,
    blurb: 'full auto · shoot the bowler, or the ball',
  },
  bat: {
    id: 'bat',
    name: 'Baseball bat',
    hold: 'bat',
    action: 'swing',
    mount: 'hand',
    cooldown: 0.9,
    automatic: false,
    actionDuration: 0.75,
    hitAt: 0.45,
    damage: 34,
    disrupt: 1,
    trauma: 0.85,
    knockback: 4.5,
    range: 1.45,
    preferredRange: [0.6, 1.1],
    magazine: 0,
    reload: 0,
    consumable: false,
    blurb: 'knocks the bowler clean out of their stance',
  },
  cheese: {
    id: 'cheese',
    name: 'Cheese wedge',
    hold: 'cheese',
    action: 'throw',
    mount: 'hand',
    cooldown: 0.8,
    automatic: false,
    actionDuration: 0.6,
    hitAt: 0.55,
    damage: 7,
    disrupt: 0.55,
    trauma: 0.3,
    knockback: 1.2,
    range: 14,
    preferredRange: [3, 8],
    magazine: 0,
    reload: 0,
    consumable: true,
    blurb: 'splats vision · lands on the lane as an obstacle',
  },
  confetti: {
    id: 'confetti',
    name: 'Confetti cannon',
    hold: 'cannon',
    action: 'blast',
    mount: 'chest',
    cooldown: 2.4,
    automatic: false,
    actionDuration: 0.5,
    hitAt: 0.05,
    damage: 4,
    disrupt: 0.7,
    trauma: 0.5,
    knockback: 5,
    range: 5,
    preferredRange: [2, 4],
    magazine: 0,
    reload: 0,
    consumable: false,
    blurb: 'blinding cone blast · blows the ball off line',
  },
};

/** Layout of the weapon stand: one entry per slot. */
export const STAND_LAYOUT: WeaponId[] = ['ak47', 'ak47', 'bat', 'bat', 'cheese', 'cheese', 'cheese', 'confetti', 'confetti'];
