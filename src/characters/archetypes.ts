import { BOWLER_LOOK, type Look } from './humanoid';

export type ArchetypeId = 'bowler' | 'fat' | 'short' | 'jimpan';

/** Gameplay + visual definition of a kind of character. */
export interface Archetype {
  id: ArchetypeId;
  name: string;
  look: Look;
  walkSpeed: number;
  runSpeed: number;
  maxHp: number;
  /** Collision radius on the floor. */
  radius: number;
  /** Multiplies knockback received (heavy characters barely move). */
  knockback: number;
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  bowler: {
    id: 'bowler',
    name: 'You',
    look: BOWLER_LOOK,
    walkSpeed: 2.2,
    runSpeed: 4.2,
    maxHp: 100,
    radius: 0.28,
    knockback: 1,
  },
  fat: {
    id: 'fat',
    name: 'Bullen',
    look: {
      height: 0.98,
      width: 1.6,
      belly: 1,
      skin: '#e8a98c',
      shirt: '#f2efe6',
      shirtPanel: null,
      pants: '#3b4a6b',
      shoes: ['#2b2b2b', '#5a5a5a'],
      hair: 'bald',
      hairColor: '#4a2f1a',
      mustache: true,
      angry: true,
    },
    walkSpeed: 1.6,
    runSpeed: 2.9,
    maxHp: 170,
    radius: 0.42,
    knockback: 0.35,
  },
  short: {
    id: 'short',
    name: 'Lillen',
    look: {
      height: 0.72,
      width: 0.92,
      belly: 0,
      skin: '#c98d68',
      shirt: '#16a34a',
      shirtPanel: '#bbf7d0',
      pants: '#52525b',
      shoes: ['#f97316', '#fafafa'],
      hair: 'cap',
      hairColor: '#dc2626',
      angry: true,
    },
    walkSpeed: 2.8,
    runSpeed: 5.6,
    maxHp: 70,
    radius: 0.24,
    knockback: 1.4,
  },
  jimpan: {
    id: 'jimpan',
    name: 'Jimpan',
    look: {
      height: 1.24,
      width: 0.7,
      belly: 0,
      skin: '#f0c4a0',
      shirt: '#111111',
      shirtPanel: '#b91c1c',
      pants: '#1e3a8a',
      shoes: ['#111111', '#e5e5e5'],
      hair: 'long',
      hairColor: '#c9a14a',
      angry: true,
    },
    walkSpeed: 2.2,
    runSpeed: 4.3,
    maxHp: 90,
    radius: 0.26,
    knockback: 1.1,
  },
};

/** Archetypes that can be spawned as saboteurs, in spawn-key order. */
export const ENEMY_ARCHETYPES: ArchetypeId[] = ['fat', 'short', 'jimpan'];
