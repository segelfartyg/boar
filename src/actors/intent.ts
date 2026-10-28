/**
 * What a controller wants its actor to do this tick.
 *
 * Intents are plain, serializable data: a remote player's client would send
 * these over the network and the authoritative Arena applies them exactly like
 * local keyboard input or AI decisions.
 */
export interface Intent {
  /** World-space move direction on the floor (x, z), length 0–1. */
  move: [number, number];
  run: boolean;
  /** Yaw to face; null = face the movement direction. */
  face: number | null;
  /** World-space point the actor aims at with its weapon. */
  aim: [number, number, number] | null;
  /** Use the held weapon (held down for automatic fire). */
  use: boolean;
  /** Pick up / put back an item. */
  interact: boolean;
  drop: boolean;
}

export const idleIntent = (): Intent => ({ move: [0, 0], run: false, face: null, aim: null, use: false, interact: false, drop: false });
